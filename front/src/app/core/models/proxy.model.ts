/** Mirrors the BFF envelopes (see bff/src/proxy/proxy.types.ts). */
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
  | 'INTERNAL'
  /** Client-side only: the BFF itself could not be reached. */
  | 'BFF_UNREACHABLE'
  /** Client-side only: the user cancelled the request. */
  | 'CANCELLED';

export interface ResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export interface Timings {
  dns: number | null;
  connect: number | null;
  tls: number | null;
  ttfb: number | null;
  download: number | null;
  total: number;
}

export interface ProxyResponseData {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  cookies: ResponseCookie[];
  contentType: string | null;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  size: number;
  encodedSize: number;
  truncated: boolean;
  finalUrl: string;
  redirects: { status: number; url: string }[];
  remoteAddress: string | null;
  warnings: string[];
}

export interface ProxySuccess {
  ok: true;
  startedAt: string;
  request: {
    method: string;
    url: string;
    headers: [string, string][];
    bodySize: number;
    droppedHeaders: { key: string; reason: string }[];
  };
  response: ProxyResponseData;
  timings: Timings;
  virtual: boolean;
}

export interface ProxyErrorInfo {
  kind: ProxyErrorKind;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export interface ProxyFailure {
  ok: false;
  startedAt: string;
  error: ProxyErrorInfo;
}

export interface ProxyLimits {
  methods: string[];
  timeoutMs: number;
  maxTimeoutMs: number;
  maxResponseBytes: number;
  maxRequestBodyBytes: number;
  maxRedirects: number;
  maxConcurrencyPerClient: number;
  allowPrivateNetworks: boolean;
  demoApi: string | null;
}
