import type { KeyValue } from '../models/request.model';
import { uid } from './id';

export interface UrlParts {
  base: string;
  query: string;
  hash: string;
}

/** Splits a URL into base, query (without `?`) and hash (without `#`) without normalizing it. */
export function splitUrl(url: string): UrlParts {
  let rest = url;
  let hash = '';
  const hashIndex = rest.indexOf('#');
  if (hashIndex >= 0) {
    hash = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
  }
  const queryIndex = rest.indexOf('?');
  if (queryIndex < 0) return { base: rest, query: '', hash };
  return { base: rest.slice(0, queryIndex), query: rest.slice(queryIndex + 1), hash };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * Encodes a query component but keeps `{{variables}}` intact and leaves a few
 * characters that are safe in a query readable.
 */
export function encodeQueryComponent(value: string): string {
  return value
    .split(/(\{\{[^{}]*\}\})/g)
    .map((part) =>
      /^\{\{[^{}]*\}\}$/.test(part)
        ? part
        : encodeURIComponent(part).replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%40/gi, '@').replace(/%24/gi, '$'),
    )
    .join('');
}

/** Parses the query string of a URL into enabled key/value pairs. */
export function parseQuery(query: string): { key: string; value: string }[] {
  if (!query) return [];
  return query
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq < 0 ? { key: safeDecode(pair), value: '' } : { key: safeDecode(pair.slice(0, eq)), value: safeDecode(pair.slice(eq + 1)) };
    });
}

export function buildQuery(params: Pick<KeyValue, 'key' | 'value' | 'enabled'>[]): string {
  return params
    .filter((p) => p.enabled && p.key.trim() !== '')
    .map((p) => (p.value === '' ? encodeQueryComponent(p.key) : `${encodeQueryComponent(p.key)}=${encodeQueryComponent(p.value)}`))
    .join('&');
}

/** Rebuilds the URL with the query generated from the enabled params. */
export function applyParamsToUrl(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const query = buildQuery(params);
  return `${base}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

/**
 * Synchronizes the params table with a URL typed by the user: enabled params
 * are replaced by what the URL contains, disabled params are kept (they are
 * not part of the URL), and ids are reused by position to keep UI state stable.
 */
export function syncParamsFromUrl(url: string, current: KeyValue[]): KeyValue[] {
  const parsed = parseQuery(splitUrl(url).query);
  const enabled = current.filter((p) => p.enabled && p.key.trim() !== '');
  const disabled = current.filter((p) => !p.enabled);
  const next: KeyValue[] = parsed.map((p, i) => ({ id: enabled[i]?.id ?? uid(), key: p.key, value: p.value, enabled: true }));
  return [...next, ...disabled];
}

export interface UrlValidation {
  valid: boolean;
  url?: string;
  error?: string;
}

/** Validates (and normalizes) a URL before sending. Adds `https://` when no scheme is given. */
export function validateRequestUrl(raw: string): UrlValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, error: 'Enter a URL' };
  if (/\{\{[^{}]*\}\}/.test(trimmed)) return { valid: false, error: 'URL contains unresolved variables' };
  if (/\s/.test(trimmed)) return { valid: false, error: 'URL must not contain spaces' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol "${url.protocol.replace(':', '')}". Use http or https.` };
  }
  if (!url.hostname) return { valid: false, error: 'URL has no host' };
  if (url.username || url.password) return { valid: false, error: 'Do not put credentials in the URL; use the Auth tab' };
  return { valid: true, url: withScheme };
}

/** `METHOD host/path` without query — used to group executions for metrics. */
export function requestKeyOf(method: string, url: string): string {
  return `${method} ${splitUrl(url).base}`;
}
