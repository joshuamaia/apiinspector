import { ProxyError } from '../errors/proxy-error.js';
import { parseTargetUrl, UrlPolicy } from './url-policy.js';

function kindOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ProxyError ? err.kind : 'UNKNOWN';
  }
}

describe('UrlPolicy', () => {
  const policy = new UrlPolicy({ allowPrivateNetworks: false, blockedHosts: ['evil.com', '.blocked.org'], allowedHosts: [] });
  const check = (url: string) => kindOf(() => policy.assertAllowed(parseTargetUrl(url)));

  it('accepts public http and https URLs', () => {
    expect(check('https://api.github.com/users')).toBeNull();
    expect(check('http://example.com:8080/path?x=1')).toBeNull();
  });

  it.each(['ftp://example.com', 'file:///etc/passwd', 'gopher://example.com', 'data:text/plain,hi', 'javascript:alert(1)'])(
    'rejects protocol in %s',
    (url) => expect(check(url)).toBe('INVALID_URL'),
  );

  it('rejects malformed and empty URLs', () => {
    expect(check('not a url')).toBe('INVALID_URL');
    expect(check('')).toBe('INVALID_URL');
    expect(check('http://')).toBe('INVALID_URL');
  });

  it('rejects credentials embedded in the URL', () => {
    expect(check('https://user:pass@example.com')).toBe('INVALID_URL');
  });

  it.each([
    'http://localhost:3000',
    'http://LOCALHOST',
    'http://api.localhost',
    'http://printer.local',
    'http://db.internal',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f.0.0.1',
    'http://0177.0.0.1',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://10.1.2.3',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://0.0.0.0',
  ])('blocks internal destination %s', (url) => {
    expect(check(url)).toBe('BLOCKED_DESTINATION');
  });

  it('blocks dangerous ports', () => {
    expect(check('http://example.com:25')).toBe('BLOCKED_DESTINATION');
    expect(check('http://example.com:22')).toBe('BLOCKED_DESTINATION');
  });

  it('applies the configured blocklist (exact and suffix)', () => {
    expect(check('https://evil.com')).toBe('BLOCKED_DESTINATION');
    expect(check('https://a.b.blocked.org')).toBe('BLOCKED_DESTINATION');
    expect(check('https://notevil.com')).toBeNull();
  });

  it('applies the allowlist when configured', () => {
    const restricted = new UrlPolicy({ allowPrivateNetworks: false, blockedHosts: [], allowedHosts: ['.typicode.com'] });
    expect(kindOf(() => restricted.assertAllowed(new URL('https://jsonplaceholder.typicode.com')))).toBeNull();
    expect(kindOf(() => restricted.assertAllowed(new URL('https://example.com')))).toBe('BLOCKED_DESTINATION');
  });

  it('allows localhost only when private networks are enabled, never metadata', () => {
    const dev = new UrlPolicy({ allowPrivateNetworks: true, blockedHosts: [], allowedHosts: [] });
    expect(kindOf(() => dev.assertAllowed(new URL('http://localhost:8080')))).toBeNull();
    expect(kindOf(() => dev.assertAllowed(new URL('http://127.0.0.1:8080')))).toBeNull();
    expect(kindOf(() => dev.assertAllowed(new URL('http://169.254.169.254')))).toBe('BLOCKED_DESTINATION');
  });
});
