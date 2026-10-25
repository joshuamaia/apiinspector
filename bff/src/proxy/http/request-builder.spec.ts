import { ProxyError } from '../errors/proxy-error.js';
import type { ExecuteRequestDto } from '../dto/execute-request.dto.js';
import { buildRequest, maskHeaders } from './request-builder.js';

const opts = { userAgent: 'Test/1.0', maxBodyBytes: 1024 };
const build = (dto: Partial<ExecuteRequestDto>) => buildRequest({ method: 'GET', url: 'https://api.test/x', ...dto } as ExecuteRequestDto, opts);
const header = (headers: { key: string; value: string }[], name: string) =>
  headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;

describe('buildRequest', () => {
  it('adds default headers without overriding user values', () => {
    const r = build({ headers: [{ key: 'accept', value: 'application/xml' }] });
    expect(header(r.headers, 'User-Agent')).toBe('Test/1.0');
    expect(header(r.headers, 'Accept')).toBe('application/xml');
    expect(header(r.headers, 'Accept-Encoding')).toBe('gzip, deflate, br');
  });

  it('ignores disabled headers and reports dropped ones', () => {
    const r = build({
      headers: [
        { key: 'X-Off', value: '1', enabled: false },
        { key: 'Host', value: 'evil.com' },
      ],
    });
    expect(header(r.headers, 'X-Off')).toBeUndefined();
    expect(header(r.headers, 'Host')).toBeUndefined();
    expect(r.droppedHeaders).toEqual([{ key: 'Host', reason: 'controlled by the proxy' }]);
  });

  it('applies bearer, basic and api key auth', () => {
    expect(header(build({ auth: { type: 'bearer', token: 'tok' } }).headers, 'Authorization')).toBe('Bearer tok');
    expect(header(build({ auth: { type: 'basic', username: 'u', password: 'p' } }).headers, 'Authorization')).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`,
    );
    expect(header(build({ auth: { type: 'apikey', key: 'X-API-Key', value: 'k1', addTo: 'header' } }).headers, 'X-API-Key')).toBe('k1');
    const q = build({ auth: { type: 'apikey', key: 'api_key', value: 'k2', addTo: 'query' } });
    expect(q.url.searchParams.get('api_key')).toBe('k2');
    expect(q.sensitiveParams).toEqual(['api_key']);
  });

  it('auth overrides a manually typed Authorization header', () => {
    const r = build({ headers: [{ key: 'authorization', value: 'old' }], auth: { type: 'bearer', token: 'new' } });
    expect(r.headers.filter((h) => h.key.toLowerCase() === 'authorization')).toEqual([{ key: 'Authorization', value: 'Bearer new' }]);
  });

  it('rejects empty bearer token and forbidden api key header', () => {
    expect(() => build({ auth: { type: 'bearer', token: ' ' } })).toThrow(ProxyError);
    expect(() => build({ auth: { type: 'apikey', key: 'Host', value: 'x' } })).toThrow(ProxyError);
  });

  it('encodes JSON, text and XML bodies with default content types', () => {
    const json = build({ method: 'POST', body: { mode: 'json', raw: '{"a":1}' } });
    expect(json.body?.toString()).toBe('{"a":1}');
    expect(header(json.headers, 'Content-Type')).toBe('application/json');
    expect(header(build({ method: 'POST', body: { mode: 'xml', raw: '<a/>' } }).headers, 'Content-Type')).toContain('application/xml');
    const custom = build({ method: 'POST', headers: [{ key: 'Content-Type', value: 'application/vnd.api+json' }], body: { mode: 'json', raw: '{}' } });
    expect(header(custom.headers, 'Content-Type')).toBe('application/vnd.api+json');
  });

  it('encodes form-urlencoded bodies', () => {
    const r = build({
      method: 'POST',
      body: { mode: 'form-urlencoded', fields: [{ key: 'a', value: '1 2' }, { key: 'b', value: 'x&y' }, { key: 'c', value: 'z', enabled: false }] },
    });
    expect(r.body?.toString()).toBe('a=1+2&b=x%26y');
  });

  it('encodes multipart bodies with files', () => {
    const r = build({
      method: 'POST',
      body: {
        mode: 'multipart',
        fields: [
          { key: 'name', value: 'Ada' },
          { key: 'file', value: '', kind: 'file', fileName: 'a.txt', contentType: 'text/plain', base64: Buffer.from('hello').toString('base64') },
        ],
      },
    });
    const ct = header(r.headers, 'Content-Type')!;
    const boundary = /boundary=(.+)$/.exec(ct)![1];
    const text = r.body!.toString();
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n`);
    expect(text).toContain('filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('never sends a body for HEAD and enforces the size limit', () => {
    expect(build({ method: 'HEAD', body: { mode: 'json', raw: '{}' } }).body).toBeNull();
    expect(() => build({ method: 'POST', body: { mode: 'text', raw: 'x'.repeat(2048) } })).toThrow(/exceeds/);
  });

  it('masks secrets in reported headers', () => {
    expect(maskHeaders([{ key: 'Authorization', value: 'Bearer abc' }, { key: 'Accept', value: '*/*' }])).toEqual([
      ['Authorization', 'Bearer ••••••'],
      ['Accept', '*/*'],
    ]);
  });
});
