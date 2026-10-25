import { createRequest, formField, kv, mergeSecrets, REDACTED, redactUrlSecrets, RequestBuildError, splitSecrets, stripSecrets, toProxyPayload } from './request';
import { headerWarning, isSensitiveHeader, suggestHeaders, suggestHeaderValues, upsertHeader } from './headers';
import { interpolate, referencedVariables } from './interpolate';

describe('toProxyPayload', () => {
  it('builds the BFF payload with enabled headers only', () => {
    const payload = toProxyPayload(
      createRequest({ method: 'GET', url: 'https://api.test/users?page=1', headers: [kv('Accept', 'application/json'), kv('X-Off', '1', false), kv('', 'x')] }),
    );
    expect(payload).toEqual({ method: 'GET', url: 'https://api.test/users?page=1', headers: [{ key: 'Accept', value: 'application/json', enabled: true }] });
  });

  it('resolves variables in url, headers, auth and body', () => {
    const def = createRequest({
      method: 'POST',
      url: '{{base}}/users/{{id}}',
      headers: [kv('X-Trace', '{{trace}}')],
      auth: { type: 'bearer', token: '{{token}}', username: '', password: '', key: '', value: '', addTo: 'header' },
      body: { mode: 'json', raw: '{"id": {{id}}}', fields: [] },
    });
    const payload = toProxyPayload(def, { base: 'https://api.test', id: 7, token: 'abc', trace: 't-1' });
    expect(payload.url).toBe('https://api.test/users/7');
    expect(payload.headers[0].value).toBe('t-1');
    expect(payload.auth).toEqual({ type: 'bearer', token: 'abc' });
    expect(payload.body).toEqual({ mode: 'json', raw: '{"id": 7}' });
  });

  it('omits the body for GET and HEAD', () => {
    const def = createRequest({ method: 'GET', url: 'https://a.test', body: { mode: 'json', raw: '{}', fields: [] } });
    expect(toProxyPayload(def).body).toBeUndefined();
    expect(toProxyPayload({ ...def, method: 'HEAD' }).body).toBeUndefined();
  });

  it('serializes form and multipart fields', () => {
    const file = { ...formField('upload'), kind: 'file' as const, fileName: 'a.txt', contentType: 'text/plain', base64: 'aGk=' };
    const def = createRequest({ method: 'POST', url: 'https://a.test', body: { mode: 'multipart', raw: '', fields: [formField('name', 'Ada'), file] } });
    expect(toProxyPayload(def).body?.fields).toEqual([
      { key: 'name', value: 'Ada', enabled: true, kind: 'text' },
      { key: 'upload', value: '', enabled: true, kind: 'file', fileName: 'a.txt', contentType: 'text/plain', base64: 'aGk=' },
    ]);
  });

  it('passes request settings', () => {
    const def = createRequest({ url: 'https://a.test', settings: { timeoutMs: 5000, followRedirects: false } });
    expect(toProxyPayload(def).options).toEqual({ timeoutMs: 5000, followRedirects: false });
  });

  it('throws for invalid or unresolved URLs', () => {
    expect(() => toProxyPayload(createRequest({ url: '' }))).toThrow(RequestBuildError);
    expect(() => toProxyPayload(createRequest({ url: '{{missing}}/x' }))).toThrow(/unresolved/);
  });
});

describe('secrets handling', () => {
  const def = createRequest({
    url: 'https://a.test/?api_key=k123&page=2',
    params: [kv('api_key', 'k123'), kv('page', '2')],
    headers: [kv('Authorization', 'Bearer xyz'), kv('X-Token', '{{token}}'), kv('Accept', '*/*')],
    auth: { type: 'basic', token: '', username: 'ada', password: 'pw', key: '', value: '', addTo: 'header' },
  });

  it('strips secrets for history/export but keeps variables and non-sensitive values', () => {
    const stripped = stripSecrets(def);
    expect(stripped.auth.password).toBe(REDACTED);
    expect(stripped.auth.username).toBe('ada');
    expect(stripped.headers.map((h) => h.value)).toEqual([REDACTED, '{{token}}', '*/*']);
    expect(stripped.params.map((p) => p.value)).toEqual([REDACTED, '2']);
    expect(stripped.url).toBe('https://a.test/?api_key=%5Bredacted%5D&page=2');
    expect(JSON.stringify(stripped)).not.toContain('k123');
    expect(JSON.stringify(stripped)).not.toContain('xyz');
  });

  it('splits and merges secrets losslessly', () => {
    const { publicDef, secrets } = splitSecrets(def);
    expect(JSON.stringify(publicDef)).not.toMatch(/k123|xyz|"pw"/);
    expect(secrets).not.toBeNull();
    expect(mergeSecrets(publicDef, secrets)).toEqual(def);
  });

  it('returns no secrets when there are none', () => {
    expect(splitSecrets(createRequest({ url: 'https://a.test' })).secrets).toBeNull();
  });

  it('redacts sensitive query params in URLs', () => {
    expect(redactUrlSecrets('https://a.test/x?token=abc&q=1#h')).toBe('https://a.test/x?token=%5Bredacted%5D&q=1#h');
  });
});

describe('headers', () => {
  it('suggests known headers by prefix first', () => {
    expect(suggestHeaders('acc').map((h) => h.name).slice(0, 3)).toEqual(['Accept', 'Accept-Language', 'Accept-Encoding']);
    expect(suggestHeaders('').length).toBeGreaterThan(0);
    expect(suggestHeaderValues('content-type', 'json')).toEqual(['application/json']);
  });

  it('warns about proxy-controlled and invalid headers', () => {
    expect(headerWarning('Host')).toMatch(/Controlled/);
    expect(headerWarning('X-Forwarded-For')).toMatch(/Controlled/);
    expect(headerWarning('Bad Header')).toMatch(/Invalid/);
    expect(headerWarning('X-Custom')).toBeNull();
  });

  it('upserts headers case-insensitively', () => {
    const headers = upsertHeader([kv('content-type', 'text/plain')], 'Content-Type', 'application/json');
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({ key: 'Content-Type', value: 'application/json' });
    expect(upsertHeader([], 'Accept', '*/*')).toHaveLength(1);
  });

  it('detects sensitive headers', () => {
    expect(isSensitiveHeader('Authorization')).toBe(true);
    expect(isSensitiveHeader('x-api-key')).toBe(true);
    expect(isSensitiveHeader('Accept')).toBe(false);
  });
});

describe('interpolate', () => {
  it('replaces known variables and keeps unknown ones', () => {
    expect(interpolate('{{a}}-{{ b }}-{{c}}', { a: 1, b: { x: true } })).toBe('1-{"x":true}-{{c}}');
    expect(referencedVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });
});
