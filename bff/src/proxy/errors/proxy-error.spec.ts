import { ProxyError, toProxyError } from './proxy-error.js';

const err = (code: string) => Object.assign(new Error(code), { code });

describe('toProxyError', () => {
  it.each([
    ['ENOTFOUND', 'DNS_FAILURE', 502],
    ['EAI_AGAIN', 'DNS_FAILURE', 502],
    ['ECONNREFUSED', 'CONNECTION_REFUSED', 502],
    ['ECONNRESET', 'CONNECTION_RESET', 502],
    ['ETIMEDOUT', 'TIMEOUT', 504],
    ['CERT_HAS_EXPIRED', 'TLS_ERROR', 502],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS_ERROR', 502],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS_ERROR', 502],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'TLS_ERROR', 502],
    ['EHOSTUNREACH', 'NETWORK_ERROR', 502],
    ['HPE_INVALID_CONSTANT', 'NETWORK_ERROR', 502],
  ])('maps %s to %s', (code, kind, status) => {
    const mapped = toProxyError(err(code));
    expect(mapped.kind).toBe(kind);
    expect(mapped.statusCode).toBe(status);
  });

  it('keeps ProxyError instances untouched', () => {
    const original = new ProxyError('BLOCKED_DESTINATION', 'x');
    expect(toProxyError(original)).toBe(original);
    expect(original.statusCode).toBe(403);
  });
});
