import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { redactUrl } from '../common/logging/redact.js';
import { DEMO_HOST, handleDemoRequest } from '../demo/demo-api.js';
import { ConcurrencyLimiter } from './concurrency/concurrency-limiter.js';
import type { ExecuteRequestDto } from './dto/execute-request.dto.js';
import { ProxyError, toProxyError } from './errors/proxy-error.js';
import { decodeBody } from './http/body-codec.js';
import { parseSetCookie } from './http/cookies.js';
import { executeHttp, type RawResponse } from './http/http-executor.js';
import { buildRequest, maskHeaders, type BuiltRequest } from './http/request-builder.js';
import type { ProxySuccess } from './proxy.types.js';
import type { Resolver } from './security/safe-lookup.js';
import { UrlPolicy } from './security/url-policy.js';

/** Injection token to replace the DNS resolver (used by tests). */
export const DNS_RESOLVER = Symbol('DNS_RESOLVER');

export interface ExecuteContext {
  clientKey: string;
  signal?: AbortSignal;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger('Proxy');
  private readonly urlPolicy: UrlPolicy;
  private readonly limiter: ConcurrencyLimiter;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(DNS_RESOLVER) private readonly resolver?: Resolver,
  ) {
    this.urlPolicy = new UrlPolicy(config.proxy);
    this.limiter = new ConcurrencyLimiter(config.proxy.maxConcurrency, config.proxy.maxConcurrencyPerClient);
  }

  async execute(dto: ExecuteRequestDto, ctx: ExecuteContext): Promise<ProxySuccess> {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const built = buildRequest(dto, {
      userAgent: this.config.proxy.userAgent,
      maxBodyBytes: this.config.proxy.maxRequestBodyBytes,
    });
    const logUrl = redactUrl(built.url, built.sensitiveParams);
    const release = this.limiter.acquire(ctx.clientKey);

    try {
      const virtual = this.config.demoApiEnabled && built.url.hostname.toLowerCase() === DEMO_HOST;
      const raw = virtual ? await this.executeDemo(built, ctx.signal, started) : await this.executeRemote(dto, built, ctx.signal);
      this.logger.log(`${built.method} ${logUrl} -> ${raw.status} (${raw.timings.total} ms)${virtual ? ' [demo]' : ''}`);
      return this.toEnvelope(built, raw, startedAt, virtual);
    } catch (err) {
      const error = toProxyError(err);
      this.logger.warn(`${built.method} ${logUrl} -> ${error.kind}: ${error.message}`);
      throw error;
    } finally {
      release();
    }
  }

  private executeRemote(dto: ExecuteRequestDto, built: BuiltRequest, signal?: AbortSignal): Promise<RawResponse> {
    const { proxy } = this.config;
    const timeoutMs = Math.min(dto.options?.timeoutMs ?? proxy.timeoutMs, proxy.maxTimeoutMs);
    return executeHttp({
      method: built.method,
      url: built.url,
      headers: built.headers,
      body: built.body,
      timeoutMs,
      followRedirects: dto.options?.followRedirects ?? true,
      maxRedirects: proxy.maxRedirects,
      maxResponseBytes: proxy.maxResponseBytes,
      signal,
      validateUrl: (url) => {
        if (this.config.demoApiEnabled && url.hostname.toLowerCase() === DEMO_HOST) {
          throw new ProxyError('BLOCKED_DESTINATION', 'Redirects to the demo host are not followed');
        }
        this.urlPolicy.assertAllowed(url);
      },
      ipPolicy: this.urlPolicy.ips,
      resolver: this.resolver,
    });
  }

  private async executeDemo(built: BuiltRequest, signal: AbortSignal | undefined, started: number): Promise<RawResponse> {
    if (built.url.protocol !== 'http:' && built.url.protocol !== 'https:') {
      throw new ProxyError('INVALID_URL', 'Only http and https are supported');
    }
    const headers: Record<string, string> = {};
    for (const { key, value } of built.headers) headers[key.toLowerCase()] = value;
    let res;
    try {
      res = await handleDemoRequest({ method: built.method, url: built.url, headers, body: built.body }, signal);
    } catch {
      throw new ProxyError('ABORTED', 'Request was cancelled by the client');
    }
    const encodedSize = res.body.length;
    const gzipped = res.headers.some(([k, v]) => k.toLowerCase() === 'content-encoding' && v === 'gzip');
    let body = gzipped ? gunzipSync(res.body) : res.body;
    if (built.method === 'HEAD') body = Buffer.alloc(0);
    const truncated = body.length > this.config.proxy.maxResponseBytes;
    if (truncated) body = body.subarray(0, this.config.proxy.maxResponseBytes);
    const total = Math.round((performance.now() - started) * 100) / 100;
    return {
      status: res.status,
      statusText: STATUS_TEXT[res.status] ?? '',
      httpVersion: '1.1',
      headers: [...res.headers, ['Date', new Date().toUTCString()]],
      setCookies: res.headers.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v),
      body,
      encodedSize,
      truncated,
      finalUrl: built.url.href,
      redirects: [],
      remoteAddress: null,
      timings: { dns: null, connect: null, tls: null, ttfb: total, download: 0, total },
      warnings: truncated ? [`Response body truncated at ${this.config.proxy.maxResponseBytes} bytes`] : [],
    };
  }

  private toEnvelope(built: BuiltRequest, raw: RawResponse, startedAt: string, virtual: boolean): ProxySuccess {
    const contentType = raw.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? null;
    const decoded = decodeBody(raw.body, contentType ?? undefined, raw.truncated);
    return {
      ok: true,
      startedAt,
      request: {
        method: built.method,
        url: redactUrl(built.url, built.sensitiveParams),
        headers: maskHeaders(built.headers),
        bodySize: built.body?.length ?? 0,
        droppedHeaders: built.droppedHeaders,
      },
      response: {
        status: raw.status,
        statusText: raw.statusText,
        httpVersion: raw.httpVersion,
        headers: raw.headers,
        cookies: parseSetCookie(raw.setCookies),
        contentType,
        body: decoded.body,
        bodyEncoding: decoded.encoding,
        size: raw.body.length,
        encodedSize: raw.encodedSize,
        truncated: raw.truncated,
        finalUrl: redactUrl(raw.finalUrl, built.sensitiveParams),
        redirects: raw.redirects,
        remoteAddress: raw.remoteAddress,
        warnings: raw.warnings,
      },
      timings: raw.timings,
      virtual,
    };
  }
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};
