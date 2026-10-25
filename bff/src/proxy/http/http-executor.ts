import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { ProxyError, toProxyError } from '../errors/proxy-error.js';
import type { HttpMethod } from '../dto/execute-request.dto.js';
import type { HeaderEntry } from '../security/header-policy.js';
import { filterResponseHeaders } from '../security/header-policy.js';
import type { IpPolicy } from '../security/ip-policy.js';
import { createSafeLookup, type Resolver } from '../security/safe-lookup.js';

export interface Timings {
  dns: number | null;
  connect: number | null;
  tls: number | null;
  ttfb: number | null;
  download: number | null;
  total: number;
}

export interface ExecuteParams {
  method: HttpMethod;
  url: URL;
  headers: HeaderEntry[];
  body: Buffer | null;
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
  /** Called for the initial URL and for every redirect target before connecting. */
  validateUrl: (url: URL) => void;
  ipPolicy: IpPolicy;
  resolver?: Resolver;
}

export interface RawResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  setCookies: string[];
  body: Buffer;
  encodedSize: number;
  truncated: boolean;
  finalUrl: string;
  redirects: { status: number; url: string }[];
  remoteAddress: string | null;
  timings: Timings;
  warnings: string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

interface Hop {
  method: HttpMethod;
  url: URL;
  headers: HeaderEntry[];
  body: Buffer | null;
}

interface HopResult {
  res: IncomingMessage;
  remoteAddress: string | null;
  timings: Pick<Timings, 'dns' | 'connect' | 'tls' | 'ttfb'>;
}

/**
 * Executes an HTTP request with full control over DNS, redirects and limits.
 * Redirects are followed manually so each hop is re-validated (protocol, host,
 * port and resolved IP) before a connection is made.
 */
export async function executeHttp(params: ExecuteParams): Promise<RawResponse> {
  const started = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs);
  const onClientAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onClientAbort, { once: true });
  if (params.signal?.aborted) controller.abort();

  const fail = (err: unknown): never => {
    if (timedOut) throw new ProxyError('TIMEOUT', `Request timed out after ${params.timeoutMs} ms`, { timeoutMs: params.timeoutMs });
    if (params.signal?.aborted) throw new ProxyError('ABORTED', 'Request was cancelled by the client');
    throw toProxyError(err);
  };

  try {
    const redirects: RawResponse['redirects'] = [];
    let hop: Hop = { method: params.method, url: params.url, headers: params.headers, body: params.body };

    for (;;) {
      params.validateUrl(hop.url);
      let result: HopResult;
      try {
        result = await sendOnce(hop, params, controller.signal, started);
      } catch (err) {
        return fail(err);
      }
      const { res } = result;
      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (params.followRedirects && REDIRECT_STATUSES.has(status) && location) {
        res.destroy();
        if (redirects.length >= params.maxRedirects) {
          throw new ProxyError('TOO_MANY_REDIRECTS', `Exceeded the maximum of ${params.maxRedirects} redirects`, {
            redirects,
          });
        }
        let next: URL;
        try {
          next = new URL(location, hop.url);
        } catch {
          throw new ProxyError('NETWORK_ERROR', `Invalid redirect location: ${location.slice(0, 200)}`);
        }
        redirects.push({ status, url: next.href });
        const changeToGet = status === 303 || ((status === 301 || status === 302) && hop.method === 'POST');
        const crossOrigin = next.origin !== hop.url.origin;
        hop = {
          method: changeToGet && hop.method !== 'HEAD' ? 'GET' : hop.method,
          url: next,
          body: changeToGet ? null : hop.body,
          headers: hop.headers.filter(({ key }) => {
            const lower = key.toLowerCase();
            if (crossOrigin && CREDENTIAL_HEADERS.has(lower)) return false;
            if (changeToGet && lower === 'content-type') return false;
            return true;
          }),
        };
        continue;
      }

      const bodyAllowed = hop.method !== 'HEAD' && status !== 204 && status !== 304;
      let read: Awaited<ReturnType<typeof readBody>>;
      try {
        read = bodyAllowed
          ? await readBody(res, params.maxResponseBytes)
          : { body: Buffer.alloc(0), encodedSize: 0, truncated: false, warnings: [] };
      } catch (err) {
        return fail(err);
      }
      const end = performance.now();
      const setCookie = res.headers['set-cookie'] ?? [];
      return {
        status,
        statusText: res.statusMessage ?? '',
        httpVersion: res.httpVersion,
        headers: filterResponseHeaders(res.rawHeaders),
        setCookies: Array.isArray(setCookie) ? setCookie : [setCookie],
        body: read.body,
        encodedSize: read.encodedSize,
        truncated: read.truncated,
        finalUrl: hop.url.href,
        redirects,
        remoteAddress: result.remoteAddress,
        timings: {
          ...result.timings,
          download: result.timings.ttfb !== null ? round(end - started - result.timings.ttfb) : null,
          total: round(end - started),
        },
        warnings: read.warnings,
      };
    }
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onClientAbort);
  }
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function sendOnce(hop: Hop, params: ExecuteParams, signal: AbortSignal, started: number): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const isHttps = hop.url.protocol === 'https:';
    const hopStart = performance.now();
    const timings: HopResult['timings'] = { dns: null, connect: null, tls: null, ttfb: null };
    const outgoing: Record<string, string> = {};
    for (const { key, value } of hop.headers) outgoing[key] = value;
    if (hop.body) outgoing['Content-Length'] = String(hop.body.length);

    const lookup = createSafeLookup(params.ipPolicy, params.resolver);
    const options: https.RequestOptions = {
      protocol: hop.url.protocol,
      hostname: hop.url.hostname.replace(/^\[|\]$/g, ''),
      port: hop.url.port || (isHttps ? 443 : 80),
      path: `${hop.url.pathname}${hop.url.search}`,
      method: hop.method,
      headers: outgoing,
      agent: false,
      signal,
      lookup: lookup as unknown as https.RequestOptions['lookup'],
      // Never send the BFF's own client certificates / credentials.
      rejectUnauthorized: true,
    };

    const req = (isHttps ? https : http).request(options);
    let remoteAddress: string | null = null;

    req.on('socket', (socket) => {
      socket.once('lookup', () => (timings.dns = round(performance.now() - hopStart)));
      socket.once('connect', () => {
        timings.connect = round(performance.now() - hopStart);
        remoteAddress = socket.remoteAddress ?? null;
        // Defense in depth: verify the address the socket actually connected to.
        if (remoteAddress && !params.ipPolicy.isAllowed(remoteAddress)) {
          req.destroy(
            new ProxyError('BLOCKED_DESTINATION', `Connection to ${remoteAddress} is not allowed`, { address: remoteAddress }),
          );
        }
      });
      socket.once('secureConnect', () => (timings.tls = round(performance.now() - hopStart)));
    });
    req.once('response', (res) => {
      timings.ttfb = round(performance.now() - started);
      resolve({ res, remoteAddress, timings });
    });
    req.once('error', reject);
    req.end(hop.body ?? undefined);
  });
}

function decoderFor(encoding: string | undefined): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

/**
 * Reads the body enforcing `maxBytes` on the DECODED size (protects against
 * decompression bombs). Bodies over the limit are truncated, not rejected.
 */
function readBody(res: IncomingMessage, maxBytes: number) {
  return new Promise<{ body: Buffer; encodedSize: number; truncated: boolean; warnings: string[] }>((resolve, reject) => {
    const warnings: string[] = [];
    const decoder = decoderFor(res.headers['content-encoding'] as string | undefined);
    const rawChunks: Buffer[] = [];
    const chunks: Buffer[] = [];
    let encodedSize = 0;
    let size = 0;
    let truncated = false;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ body: Buffer.concat(chunks), encodedSize, truncated, warnings });
    };

    const source: Readable = decoder ?? res;
    res.on('data', (chunk: Buffer) => {
      encodedSize += chunk.length;
      if (decoder && encodedSize <= maxBytes) rawChunks.push(chunk);
    });
    if (decoder) {
      res.pipe(decoder);
      decoder.on('error', () => {
        // Undecodable content-encoding: fall back to the raw bytes.
        warnings.push('Failed to decode content-encoding; showing raw bytes');
        chunks.length = 0;
        chunks.push(...rawChunks);
        size = rawChunks.reduce((n, c) => n + c.length, 0);
        res.destroy();
        finish();
      });
    }
    source.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const remaining = maxBytes - size;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        size = maxBytes;
        truncated = true;
        warnings.push(`Response body truncated at ${maxBytes} bytes`);
        res.destroy();
        decoder?.destroy();
        finish();
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    source.on('end', finish);
    res.on('error', (err) => {
      if (truncated || settled) return;
      settled = true;
      reject(err);
    });
    res.on('aborted', () => {
      if (truncated || settled) return;
      settled = true;
      reject(Object.assign(new Error('Response aborted by the remote host'), { code: 'ECONNRESET' }));
    });
  });
}
