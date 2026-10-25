import { applyParamsToUrl, buildQuery, parseQuery, requestKeyOf, splitUrl, syncParamsFromUrl, validateRequestUrl } from './url';
import { kv } from './request';

describe('url utils', () => {
  it('splits URLs without normalizing them', () => {
    expect(splitUrl('https://a.com/x?y=1&z=2#frag')).toEqual({ base: 'https://a.com/x', query: 'y=1&z=2', hash: 'frag' });
    expect(splitUrl('{{base}}/users')).toEqual({ base: '{{base}}/users', query: '', hash: '' });
  });

  it('parses query strings, decoding values safely', () => {
    expect(parseQuery('a=1&b=hello%20world&c&d=x+y&e=%E0%A4%A')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: 'hello world' },
      { key: 'c', value: '' },
      { key: 'd', value: 'x y' },
      { key: 'e', value: '%E0%A4%A' },
    ]);
  });

  it('builds query strings from enabled params and keeps variables', () => {
    expect(
      buildQuery([
        { key: 'q', value: 'a b&c', enabled: true },
        { key: 'off', value: '1', enabled: false },
        { key: 'token', value: '{{token}}', enabled: true },
        { key: 'flag', value: '', enabled: true },
      ]),
    ).toBe('q=a%20b%26c&token={{token}}&flag');
  });

  it('rebuilds the URL keeping the hash', () => {
    expect(applyParamsToUrl('https://a.com/x?old=1#top', [kv('page', '2')])).toBe('https://a.com/x?page=2#top');
    expect(applyParamsToUrl('https://a.com/x?old=1', [])).toBe('https://a.com/x');
  });

  it('syncs params from a typed URL, keeping disabled params and ids', () => {
    const first = kv('a', '1');
    const disabled = kv('b', '2', false);
    const next = syncParamsFromUrl('https://a.com/?a=9&c=3', [first, disabled]);
    expect(next.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['a', '9', true],
      ['c', '3', true],
      ['b', '2', false],
    ]);
    expect(next[0].id).toBe(first.id);
  });

  it('validates request URLs', () => {
    expect(validateRequestUrl('https://api.github.com')).toEqual({ valid: true, url: 'https://api.github.com' });
    expect(validateRequestUrl('example.com/x')).toEqual({ valid: true, url: 'https://example.com/x' });
    expect(validateRequestUrl('').valid).toBe(false);
    expect(validateRequestUrl('ftp://x.com').error).toMatch(/Unsupported protocol/);
    expect(validateRequestUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateRequestUrl('https://u:p@x.com').valid).toBe(false);
    expect(validateRequestUrl('https://x.com/a b').valid).toBe(false);
    expect(validateRequestUrl('{{base}}/x').error).toMatch(/unresolved/);
    expect(validateRequestUrl('http://').valid).toBe(false);
  });

  it('builds a stable request key', () => {
    expect(requestKeyOf('GET', 'https://a.com/users?page=1')).toBe('GET https://a.com/users');
  });
});
