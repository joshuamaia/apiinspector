export type ProxyErrorKind =
  | 'VALIDATION'
  | 'INVALID_URL'
  | 'BLOCKED_DESTINATION'
  | 'DNS_FAILURE'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_RESET'
  | 'TIMEOUT'
  | 'TLS_ERROR'
  | 'TOO_MANY_REDIRECTS'
  | 'ABORTED'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'CONCURRENCY_LIMIT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ORIGIN'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

const STATUS_BY_KIND: Record<ProxyErrorKind, number> = {
  VALIDATION: 400,
  INVALID_URL: 400,
  BLOCKED_DESTINATION: 403,
  DNS_FAILURE: 502,
  CONNECTION_REFUSED: 502,
  CONNECTION_RESET: 502,
  TIMEOUT: 504,
  TLS_ERROR: 502,
  TOO_MANY_REDIRECTS: 502,
  ABORTED: 499,
  NETWORK_ERROR: 502,
  RATE_LIMITED: 429,
  CONCURRENCY_LIMIT: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

/** Transport / policy error: the upstream API did not produce an HTTP response. */
export class ProxyError extends Error {
  readonly statusCode: number;

  constructor(
    readonly kind: ProxyErrorKind,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProxyError';
    this.statusCode = STATUS_BY_KIND[kind];
  }
}

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
]);

/** Maps low-level Node.js network errors to a stable error kind. */
export function toProxyError(err: unknown): ProxyError {
  if (err instanceof ProxyError) return err;
  const e = err as NodeJS.ErrnoException & { reason?: string };
  const code = e?.code ?? '';
  const message = e?.message ?? String(err);

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL' || code === 'ENODATA') {
    return new ProxyError('DNS_FAILURE', `DNS lookup failed for host (${code})`, { code });
  }
  if (code === 'ECONNREFUSED') return new ProxyError('CONNECTION_REFUSED', 'Connection refused by the remote host', { code });
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
    return new ProxyError('CONNECTION_RESET', 'Connection was reset by the remote host', { code });
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return new ProxyError('TIMEOUT', 'Connection timed out', { code });
  if (TLS_CODES.has(code) || code.startsWith('ERR_SSL') || code.startsWith('ERR_TLS')) {
    return new ProxyError('TLS_ERROR', `TLS/certificate error: ${message}`, { code });
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EADDRNOTAVAIL') {
    return new ProxyError('NETWORK_ERROR', 'Remote host is unreachable', { code });
  }
  if (code === 'HPE_INVALID_CONSTANT' || code.startsWith('HPE_')) {
    return new ProxyError('NETWORK_ERROR', 'Remote server sent an invalid HTTP response', { code });
  }
  return new ProxyError('NETWORK_ERROR', message || 'Network error', code ? { code } : undefined);
}
