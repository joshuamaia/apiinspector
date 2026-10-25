export const APP_CONFIG = Symbol('APP_CONFIG');

export interface ProxyLimits {
  /** Default timeout for a proxied request (ms). */
  timeoutMs: number;
  /** Upper bound a client may request for the timeout (ms). */
  maxTimeoutMs: number;
  /** Maximum decoded response body kept in memory; larger bodies are truncated. */
  maxResponseBytes: number;
  /** Maximum request body (JSON payload sent by the frontend). */
  maxRequestBodyBytes: number;
  maxRedirects: number;
  /** Simultaneous upstream requests for the whole BFF. */
  maxConcurrency: number;
  /** Simultaneous upstream requests per client (IP). */
  maxConcurrencyPerClient: number;
}

export interface AppConfig {
  port: number;
  /** Value passed to Express `trust proxy` (false disables). */
  trustProxy: boolean | string | number;
  /** Origins allowed via CORS / Origin check. Empty = same-origin only. */
  allowedOrigins: string[];
  /** Optional shared secret required in the `x-api-inspector-token` header. */
  accessToken: string | null;
  rateLimit: { windowMs: number; max: number };
  proxy: ProxyLimits & {
    /** DANGEROUS: allow loopback/private ranges (local development only). */
    allowPrivateNetworks: boolean;
    /** Extra hostnames (or `.suffix`) that are always blocked. */
    blockedHosts: string[];
    /** When not empty, only these hostnames (or `.suffix`) can be reached. */
    allowedHosts: string[];
    userAgent: string;
  };
  demoApiEnabled: boolean;
}

type EnvReader = (key: string) => string | undefined;

function int(read: EnvReader, key: string, fallback: number, min = 0): number {
  const raw = read(key);
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Invalid value for ${key}: "${raw}" (expected integer >= ${min})`);
  }
  return value;
}

function bool(read: EnvReader, key: string, fallback: boolean): boolean {
  const raw = read(key)?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`Invalid boolean for ${key}: "${raw}"`);
}

function list(read: EnvReader, key: string): string[] {
  return (read(key) ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function trustProxy(raw: string | undefined): boolean | string | number {
  if (raw === undefined || raw.trim() === '') return false;
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadAppConfig(read: EnvReader): AppConfig {
  const timeoutMs = int(read, 'PROXY_TIMEOUT_MS', 30_000, 100);
  const config: AppConfig = {
    port: int(read, 'PORT', 3000, 1),
    trustProxy: trustProxy(read('TRUST_PROXY')),
    allowedOrigins: (read('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((v) => v.trim().replace(/\/$/, ''))
      .filter(Boolean),
    accessToken: read('ACCESS_TOKEN')?.trim() || null,
    rateLimit: {
      windowMs: int(read, 'RATE_LIMIT_WINDOW_MS', 60_000, 1000),
      max: int(read, 'RATE_LIMIT_MAX', 120, 1),
    },
    proxy: {
      timeoutMs,
      maxTimeoutMs: Math.max(timeoutMs, int(read, 'PROXY_MAX_TIMEOUT_MS', 120_000, 100)),
      maxResponseBytes: int(read, 'PROXY_MAX_RESPONSE_BYTES', 10 * 1024 * 1024, 1024),
      maxRequestBodyBytes: int(read, 'PROXY_MAX_REQUEST_BODY_BYTES', 5 * 1024 * 1024, 1024),
      maxRedirects: int(read, 'PROXY_MAX_REDIRECTS', 5, 0),
      maxConcurrency: int(read, 'PROXY_MAX_CONCURRENCY', 20, 1),
      maxConcurrencyPerClient: int(read, 'PROXY_MAX_CONCURRENCY_PER_CLIENT', 5, 1),
      allowPrivateNetworks: bool(read, 'PROXY_ALLOW_PRIVATE_NETWORKS', false),
      blockedHosts: list(read, 'PROXY_BLOCKED_HOSTS'),
      allowedHosts: list(read, 'PROXY_ALLOWED_HOSTS'),
      userAgent: read('PROXY_USER_AGENT')?.trim() || 'API-Inspector/1.0',
    },
    demoApiEnabled: bool(read, 'DEMO_API_ENABLED', true),
  };
  return config;
}
