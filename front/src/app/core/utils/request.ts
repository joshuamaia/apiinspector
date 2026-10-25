import {
  methodAllowsBody,
  type AuthConfig,
  type FormField,
  type HttpMethod,
  type KeyValue,
  type RequestDefinition,
} from '../models/request.model';
import { isSensitiveHeader, isSensitiveParam } from './headers';
import { uid } from './id';
import { interpolate, type Variables } from './interpolate';
import { validateRequestUrl } from './url';

export function emptyAuth(): AuthConfig {
  return { type: 'none', token: '', username: '', password: '', key: 'X-API-Key', value: '', addTo: 'header' };
}

export function kv(key = '', value = '', enabled = true): KeyValue {
  return { id: uid(), key, value, enabled };
}

export function formField(key = '', value = ''): FormField {
  return { id: uid(), key, value, enabled: true, kind: 'text' };
}

export function createRequest(partial: Partial<RequestDefinition> = {}): RequestDefinition {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: emptyAuth(),
    body: { mode: 'none', raw: '', fields: [] },
    settings: { timeoutMs: null, followRedirects: true },
    ...partial,
  };
}

export function cloneRequest(def: RequestDefinition): RequestDefinition {
  return structuredClone(def);
}

/** Payload accepted by `POST /api/proxy/execute`. */
export interface ProxyPayload {
  method: HttpMethod;
  url: string;
  headers: { key: string; value: string; enabled: boolean }[];
  auth?: Partial<AuthConfig> & { type: AuthConfig['type'] };
  body?: {
    mode: string;
    raw?: string;
    fields?: { key: string; value: string; enabled: boolean; kind: 'text' | 'file'; fileName?: string; contentType?: string; base64?: string }[];
  };
  options?: { timeoutMs?: number; followRedirects?: boolean };
}

export class RequestBuildError extends Error {}

/**
 * Converts a request definition into the BFF payload, resolving `{{vars}}`.
 * The URL already carries the enabled params (they are kept in sync by the editor).
 */
export function toProxyPayload(def: RequestDefinition, vars: Variables = {}): ProxyPayload {
  const resolve = (value: string) => interpolate(value, vars);
  const validation = validateRequestUrl(resolve(def.url));
  if (!validation.valid) throw new RequestBuildError(validation.error ?? 'Invalid URL');

  const payload: ProxyPayload = {
    method: def.method,
    url: validation.url!,
    headers: def.headers
      .filter((h) => h.enabled && h.key.trim())
      .map((h) => ({ key: resolve(h.key.trim()), value: resolve(h.value), enabled: true })),
  };

  const auth = def.auth;
  switch (auth.type) {
    case 'bearer':
      payload.auth = { type: 'bearer', token: resolve(auth.token) };
      break;
    case 'basic':
      payload.auth = { type: 'basic', username: resolve(auth.username), password: resolve(auth.password) };
      break;
    case 'apikey':
      payload.auth = { type: 'apikey', key: resolve(auth.key), value: resolve(auth.value), addTo: auth.addTo };
      break;
  }

  if (methodAllowsBody(def.method) && def.body.mode !== 'none') {
    const { mode } = def.body;
    if (mode === 'json' || mode === 'text' || mode === 'xml') {
      payload.body = { mode, raw: resolve(def.body.raw) };
    } else {
      payload.body = {
        mode,
        fields: def.body.fields
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => ({
            key: resolve(f.key),
            value: f.kind === 'file' ? '' : resolve(f.value),
            enabled: true,
            kind: mode === 'multipart' ? f.kind : 'text',
            ...(mode === 'multipart' && f.kind === 'file' ? { fileName: f.fileName, contentType: f.contentType, base64: f.base64 } : {}),
          })),
      };
    }
  }

  const options: ProxyPayload['options'] = {};
  if (def.settings.timeoutMs) options.timeoutMs = def.settings.timeoutMs;
  if (!def.settings.followRedirects) options.followRedirects = false;
  if (Object.keys(options).length) payload.options = options;
  return payload;
}

/** Placeholder stored instead of secret values in history and exports. */
export const REDACTED = '[redacted]';

/** Removes auth secrets and sensitive header/param values. Used for history and export. */
export function stripSecrets(def: RequestDefinition): RequestDefinition {
  const copy = cloneRequest(def);
  copy.auth = { ...copy.auth, token: copy.auth.token ? REDACTED : '', password: copy.auth.password ? REDACTED : '', value: copy.auth.value ? REDACTED : '' };
  copy.headers = copy.headers.map((h) => (isSensitiveHeader(h.key) && h.value && !isVariable(h.value) ? { ...h, value: REDACTED } : h));
  copy.params = copy.params.map((p) => (isSensitiveParam(p.key) && p.value && !isVariable(p.value) ? { ...p, value: REDACTED } : p));
  copy.url = redactUrlSecrets(copy.url);
  copy.body = { ...copy.body, fields: copy.body.fields.map((f) => (f.kind === 'file' ? { ...f, base64: undefined } : f)) };
  return copy;
}

function isVariable(value: string): boolean {
  return /^\{\{[^{}]+\}\}$/.test(value.trim());
}

/** Redacts the value of sensitive query params inside a URL string. */
export function redactUrlSecrets(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hashIndex = url.indexOf('#', q);
  const query = url.slice(q + 1, hashIndex < 0 ? undefined : hashIndex);
  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      return isSensitiveParam(key) && value && !isVariable(value) ? `${key}=${encodeURIComponent(REDACTED)}` : pair;
    })
    .join('&');
  return `${url.slice(0, q + 1)}${redacted}${hashIndex < 0 ? '' : url.slice(hashIndex)}`;
}

/** Secrets extracted from a request so they can be encrypted separately. */
export interface RequestSecrets {
  auth: Pick<AuthConfig, 'token' | 'password' | 'value'>;
  headers: Record<string, string>;
  params: Record<string, string>;
  url?: string;
}

export function splitSecrets(def: RequestDefinition): { publicDef: RequestDefinition; secrets: RequestSecrets | null } {
  const secrets: RequestSecrets = { auth: { token: def.auth.token, password: def.auth.password, value: def.auth.value }, headers: {}, params: {} };
  for (const h of def.headers) if (isSensitiveHeader(h.key) && h.value && !isVariable(h.value)) secrets.headers[h.id] = h.value;
  for (const p of def.params) if (isSensitiveParam(p.key) && p.value && !isVariable(p.value)) secrets.params[p.id] = p.value;
  const publicDef = stripSecrets(def);
  if (publicDef.url !== def.url) secrets.url = def.url;
  const hasSecrets =
    !!(secrets.auth.token || secrets.auth.password || secrets.auth.value) ||
    Object.keys(secrets.headers).length > 0 ||
    Object.keys(secrets.params).length > 0 ||
    !!secrets.url;
  // Keep file contents: they are not secrets, only removed from history to save space.
  publicDef.body = def.body;
  return { publicDef: blankRedacted(publicDef), secrets: hasSecrets ? secrets : null };
}

/** Replaces redaction markers with empty strings (for definitions whose secrets were dropped). */
export function blankRedacted(def: RequestDefinition): RequestDefinition {
  const blank = (v: string) => (v === REDACTED ? '' : v);
  return {
    ...def,
    auth: { ...def.auth, token: blank(def.auth.token), password: blank(def.auth.password), value: blank(def.auth.value) },
    headers: def.headers.map((h) => ({ ...h, value: blank(h.value) })),
    params: def.params.map((p) => ({ ...p, value: blank(p.value) })),
  };
}

export function mergeSecrets(def: RequestDefinition, secrets: RequestSecrets | null): RequestDefinition {
  if (!secrets) return def;
  return {
    ...def,
    url: secrets.url ?? def.url,
    auth: { ...def.auth, ...secrets.auth },
    headers: def.headers.map((h) => (secrets.headers[h.id] !== undefined ? { ...h, value: secrets.headers[h.id] } : h)),
    params: def.params.map((p) => (secrets.params[p.id] !== undefined ? { ...p, value: secrets.params[p.id] } : p)),
  };
}
