/** RFC 7230 token: valid header field name. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Hop-by-hop headers (RFC 7230 §6.1) — never forwarded in either direction. */
export const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Request headers the user may not set: computed by the proxy, used to spoof
 * client identity towards the target, or internal to the BFF.
 */
const FORBIDDEN_REQUEST = new Set([
  ...HOP_BY_HOP,
  'host',
  'content-length',
  'expect',
  'forwarded',
  'via',
  'x-real-ip',
  'x-client-ip',
  'true-client-ip',
  'cf-connecting-ip',
  'x-api-inspector-token',
]);

export interface HeaderEntry {
  key: string;
  value: string;
}

export interface FilteredHeaders {
  headers: HeaderEntry[];
  dropped: { key: string; reason: string }[];
}

export function isValidHeaderName(name: string): boolean {
  return HEADER_NAME.test(name);
}

/** Filters user supplied request headers according to the proxy rules. */
export function filterRequestHeaders(entries: HeaderEntry[]): FilteredHeaders {
  const headers: HeaderEntry[] = [];
  const dropped: FilteredHeaders['dropped'] = [];
  for (const { key: rawKey, value: rawValue } of entries) {
    const key = rawKey.trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (!isValidHeaderName(key)) {
      dropped.push({ key, reason: 'invalid header name' });
      continue;
    }
    if (FORBIDDEN_REQUEST.has(lower) || lower.startsWith('x-forwarded-') || lower.startsWith('proxy-')) {
      dropped.push({ key, reason: 'controlled by the proxy' });
      continue;
    }
    const value = String(rawValue ?? '');
    if (/[\r\n\0]/.test(value)) {
      dropped.push({ key, reason: 'value contains forbidden control characters' });
      continue;
    }
    headers.push({ key, value });
  }
  return { headers, dropped };
}

/** Removes hop-by-hop headers (including those listed in `Connection`) from a response. */
export function filterResponseHeaders(raw: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
  const connectionTokens = new Set(
    pairs
      .filter(([k]) => k.toLowerCase() === 'connection')
      .flatMap(([, v]) => v.split(',').map((t) => t.trim().toLowerCase())),
  );
  return pairs.filter(([k]) => {
    const lower = k.toLowerCase();
    return !HOP_BY_HOP.has(lower) && !connectionTokens.has(lower);
  });
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token)$/i;

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER.test(name) || /(token|secret|password|api[-_]?key)/i.test(name);
}

export function maskValue(value: string): string {
  if (!value) return value;
  const scheme = /^(Bearer|Basic|Digest|Token)\s+/i.exec(value);
  const prefix = scheme ? scheme[0] : '';
  return `${prefix}••••••`;
}
