import { filterRequestHeaders, filterResponseHeaders, isSensitiveHeader, maskValue } from './header-policy.js';

describe('header policy', () => {
  it('keeps regular and custom headers', () => {
    const { headers, dropped } = filterRequestHeaders([
      { key: 'Accept', value: 'application/json' },
      { key: 'X-Custom-Thing', value: 'abc' },
      { key: 'Authorization', value: 'Bearer x' },
      { key: 'Cookie', value: 'a=1' },
    ]);
    expect(headers.map((h) => h.key)).toEqual(['Accept', 'X-Custom-Thing', 'Authorization', 'Cookie']);
    expect(dropped).toEqual([]);
  });

  it.each([
    'Host',
    'Content-Length',
    'Connection',
    'Transfer-Encoding',
    'Upgrade',
    'TE',
    'Keep-Alive',
    'Proxy-Authorization',
    'X-Forwarded-For',
    'X-Forwarded-Host',
    'Forwarded',
    'X-Real-IP',
    'X-API-Inspector-Token',
  ])('drops controlled header %s', (key) => {
    const { headers, dropped } = filterRequestHeaders([{ key, value: 'v' }]);
    expect(headers).toEqual([]);
    expect(dropped[0].key).toBe(key);
  });

  it('drops invalid names and header injection attempts', () => {
    const { headers, dropped } = filterRequestHeaders([
      { key: 'Bad Header', value: 'x' },
      { key: 'X-Inject', value: 'a\r\nHost: evil.com' },
      { key: '   ', value: 'ignored' },
    ]);
    expect(headers).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(['invalid header name', 'value contains forbidden control characters']);
  });

  it('removes hop-by-hop headers and those listed in Connection from responses', () => {
    const result = filterResponseHeaders([
      'Content-Type', 'application/json',
      'Connection', 'keep-alive, X-Internal',
      'Keep-Alive', 'timeout=5',
      'X-Internal', 'secret',
      'Transfer-Encoding', 'chunked',
      'Set-Cookie', 'a=1',
      'Set-Cookie', 'b=2',
    ]);
    expect(result).toEqual([
      ['Content-Type', 'application/json'],
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ]);
  });

  it('identifies and masks sensitive headers', () => {
    expect(isSensitiveHeader('Authorization')).toBe(true);
    expect(isSensitiveHeader('X-API-Key')).toBe(true);
    expect(isSensitiveHeader('X-Session-Token')).toBe(true);
    expect(isSensitiveHeader('Accept')).toBe(false);
    expect(maskValue('Bearer abc.def')).toBe('Bearer ••••••');
    expect(maskValue('raw-secret')).toBe('••••••');
  });
});
