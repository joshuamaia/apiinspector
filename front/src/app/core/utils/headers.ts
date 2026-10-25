import type { KeyValue } from '../models/request.model';
import { uid } from './id';

export interface HeaderSuggestion {
  name: string;
  description: string;
  values: string[];
}

/** Common request headers offered by the autocomplete. */
export const KNOWN_HEADERS: HeaderSuggestion[] = [
  { name: 'Authorization', description: 'Credentials for the target API', values: ['Bearer ', 'Basic '] },
  { name: 'Content-Type', description: 'Media type of the request body', values: ['application/json', 'application/xml', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'] },
  { name: 'Accept', description: 'Media types the client accepts', values: ['application/json', '*/*', 'application/xml', 'text/html', 'text/plain'] },
  { name: 'Accept-Language', description: 'Preferred response languages', values: ['en-US', 'pt-BR', 'pt-BR,pt;q=0.9,en;q=0.8', 'es-ES'] },
  { name: 'Accept-Encoding', description: 'Accepted content encodings', values: ['gzip, deflate, br', 'identity'] },
  { name: 'Cache-Control', description: 'Caching directives', values: ['no-cache', 'no-store', 'max-age=0'] },
  { name: 'If-None-Match', description: 'Conditional request on ETag', values: ['"etag-value"'] },
  { name: 'If-Modified-Since', description: 'Conditional request on date', values: [new Date(0).toUTCString()] },
  { name: 'X-API-Key', description: 'API key (prefer the Auth tab)', values: [] },
  { name: 'User-Agent', description: 'Client identification', values: ['API-Inspector/1.0'] },
  { name: 'X-Request-ID', description: 'Correlation identifier', values: [] },
  { name: 'Cookie', description: 'Cookies sent to the target', values: [] },
  { name: 'Origin', description: 'Origin of the request', values: [] },
  { name: 'Referer', description: 'Referring page', values: [] },
  { name: 'Prefer', description: 'Server behaviour preferences', values: ['return=representation', 'return=minimal'] },
];

/** Headers the proxy controls; they are dropped by the BFF. */
export const PROXY_CONTROLLED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'forwarded',
  'via',
  'x-real-ip',
]);

export function headerWarning(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  if (PROXY_CONTROLLED_HEADERS.has(lower) || lower.startsWith('x-forwarded-') || lower.startsWith('proxy-')) {
    return 'Controlled by the proxy: this header will not be sent';
  }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name.trim())) return 'Invalid header name';
  return null;
}

export function suggestHeaders(query: string, limit = 8): HeaderSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return KNOWN_HEADERS.slice(0, limit);
  return KNOWN_HEADERS.filter((h) => h.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
    .slice(0, limit);
}

export function suggestHeaderValues(header: string, query: string): string[] {
  const known = KNOWN_HEADERS.find((h) => h.name.toLowerCase() === header.trim().toLowerCase());
  if (!known) return [];
  const q = query.trim().toLowerCase();
  return known.values.filter((v) => !q || v.toLowerCase().includes(q));
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token)$/i;
const SENSITIVE_NAME = /(token|secret|password|passwd|api[-_]?key|apikey|auth|session|signature|credential)/i;

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER.test(name.trim()) || SENSITIVE_NAME.test(name);
}

export function isSensitiveParam(name: string): boolean {
  return SENSITIVE_NAME.test(name) || /^(key|code|sig|jwt)$/i.test(name.trim());
}

/** Sets (or replaces case-insensitively) a header in a list, returning a new list. */
export function upsertHeader(headers: KeyValue[], key: string, value: string): KeyValue[] {
  const index = headers.findIndex((h) => h.key.trim().toLowerCase() === key.toLowerCase());
  if (index < 0) return [...headers, { id: uid(), key, value, enabled: true }];
  return headers.map((h, i) => (i === index ? { ...h, key, value, enabled: true } : h));
}

export function findHeader(headers: [string, string][], name: string): string | undefined {
  return headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}
