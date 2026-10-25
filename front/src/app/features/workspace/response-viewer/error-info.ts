import type { ProxyErrorKind } from '../../../core/models/proxy.model';

export interface ErrorExplanation {
  title: string;
  icon: string;
  hint: string;
  /** Transport errors mean the target never produced an HTTP response. */
  transport: boolean;
}

const INFO: Record<ProxyErrorKind, ErrorExplanation> = {
  TIMEOUT: { title: 'Request timed out', icon: 'clock', transport: true, hint: 'The target did not answer in time. Increase the timeout in the Settings tab or check whether the API is overloaded.' },
  DNS_FAILURE: { title: 'DNS lookup failed', icon: 'globe', transport: true, hint: 'The host name could not be resolved. Check for typos in the domain or whether the domain exists.' },
  CONNECTION_REFUSED: { title: 'Connection refused', icon: 'plug', transport: true, hint: 'The host is reachable but nothing is listening on that port.' },
  CONNECTION_RESET: { title: 'Connection reset', icon: 'plug', transport: true, hint: 'The remote server closed the connection unexpectedly.' },
  TLS_ERROR: { title: 'TLS / certificate error', icon: 'lock', transport: true, hint: 'The server certificate is invalid, expired, self-signed or does not match the host name. The proxy always verifies certificates.' },
  TOO_MANY_REDIRECTS: { title: 'Too many redirects', icon: 'refresh', transport: true, hint: 'The redirect chain exceeded the configured limit (possible redirect loop).' },
  NETWORK_ERROR: { title: 'Network error', icon: 'alert', transport: true, hint: 'A low-level network problem prevented the request from completing.' },
  BLOCKED_DESTINATION: {
    title: 'Destination blocked by the proxy',
    icon: 'shield-alert',
    transport: true,
    hint: 'To prevent SSRF, the BFF blocks localhost, private/link-local ranges, cloud metadata endpoints and dangerous ports — including after DNS resolution and on every redirect.',
  },
  INVALID_URL: { title: 'Invalid URL', icon: 'link', transport: false, hint: 'Use an absolute http(s) URL such as https://api.example.com/users.' },
  VALIDATION: { title: 'Invalid request', icon: 'alert', transport: false, hint: 'The backend rejected the request definition.' },
  ABORTED: { title: 'Request aborted', icon: 'square', transport: true, hint: 'The request was aborted before completing.' },
  CANCELLED: { title: 'Request cancelled', icon: 'square', transport: true, hint: 'You cancelled the request.' },
  RATE_LIMITED: { title: 'Rate limit reached', icon: 'clock', transport: false, hint: 'The API Inspector backend limits how many requests can be sent per minute. Wait a moment and retry.' },
  CONCURRENCY_LIMIT: { title: 'Too many simultaneous requests', icon: 'layers', transport: false, hint: 'Wait for running requests to finish before sending more.' },
  UNAUTHORIZED: { title: 'Backend access denied', icon: 'lock', transport: false, hint: 'The BFF requires an access token. Set it in Settings.' },
  FORBIDDEN_ORIGIN: { title: 'Origin not allowed', icon: 'shield-alert', transport: false, hint: 'This page origin is not in the BFF ALLOWED_ORIGINS list.' },
  PAYLOAD_TOO_LARGE: { title: 'Request body too large', icon: 'file', transport: false, hint: 'The request body exceeds the backend limit.' },
  BFF_UNREACHABLE: { title: 'Backend unreachable', icon: 'server', transport: true, hint: 'The API Inspector BFF is not responding. Start it with "docker compose up" or "npm run start:dev" in /bff.' },
  INTERNAL: { title: 'Internal error', icon: 'alert', transport: false, hint: 'Unexpected backend error. Check the BFF logs.' },
};

export function explainError(kind: ProxyErrorKind): ErrorExplanation {
  return INFO[kind] ?? INFO.INTERNAL;
}
