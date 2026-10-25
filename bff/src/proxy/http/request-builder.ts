import { randomBytes } from 'node:crypto';
import { ProxyError } from '../errors/proxy-error.js';
import type { AuthDto, BodyDto, ExecuteRequestDto, HttpMethod } from '../dto/execute-request.dto.js';
import { filterRequestHeaders, isSensitiveHeader, maskValue, type HeaderEntry } from '../security/header-policy.js';
import { parseTargetUrl } from '../security/url-policy.js';

export interface BuiltRequest {
  method: HttpMethod;
  url: URL;
  headers: HeaderEntry[];
  body: Buffer | null;
  droppedHeaders: { key: string; reason: string }[];
  /** Names of query parameters that carry secrets (used for log redaction). */
  sensitiveParams: string[];
}

export interface BuildOptions {
  userAgent: string;
  maxBodyBytes: number;
}

function setHeader(headers: HeaderEntry[], key: string, value: string): void {
  const index = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
  if (index >= 0) headers.splice(index, 1);
  headers.push({ key, value });
}

function hasHeader(headers: HeaderEntry[], key: string): boolean {
  return headers.some((h) => h.key.toLowerCase() === key.toLowerCase());
}

function applyAuth(auth: AuthDto | undefined, url: URL, headers: HeaderEntry[], sensitiveParams: string[]): void {
  if (!auth || auth.type === 'none') return;
  switch (auth.type) {
    case 'bearer': {
      const token = (auth.token ?? '').trim();
      if (!token) throw new ProxyError('VALIDATION', 'Bearer token is empty');
      setHeader(headers, 'Authorization', `Bearer ${token}`);
      return;
    }
    case 'basic': {
      const encoded = Buffer.from(`${auth.username ?? ''}:${auth.password ?? ''}`, 'utf8').toString('base64');
      setHeader(headers, 'Authorization', `Basic ${encoded}`);
      return;
    }
    case 'apikey': {
      const key = (auth.key ?? '').trim();
      if (!key) throw new ProxyError('VALIDATION', 'API key name is empty');
      if (auth.addTo === 'query') {
        url.searchParams.set(key, auth.value ?? '');
        sensitiveParams.push(key);
      } else {
        if (/[\r\n\0]/.test(auth.value ?? '')) throw new ProxyError('VALIDATION', 'API key contains control characters');
        if (filterRequestHeaders([{ key, value: '' }]).dropped.length) {
          throw new ProxyError('VALIDATION', `"${key}" cannot be used as API key header`);
        }
        setHeader(headers, key, auth.value ?? '');
      }
      return;
    }
  }
}

function encodeMultipart(body: BodyDto, maxBytes: number): { buffer: Buffer; contentType: string } {
  const boundary = `----APIInspector${randomBytes(12).toString('hex')}`;
  const parts: Buffer[] = [];
  const escape = (v: string) => v.replace(/"/g, '%22').replace(/[\r\n]/g, ' ');
  for (const field of body.fields ?? []) {
    if (field.enabled === false || !field.key.trim()) continue;
    if (field.kind === 'file') {
      const content = Buffer.from(field.base64 ?? '', 'base64');
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${escape(field.key)}"; filename="${escape(field.fileName || 'file')}"\r\n` +
            `Content-Type: ${(field.contentType || 'application/octet-stream').replace(/[\r\n]/g, '')}\r\n\r\n`,
        ),
        content,
        Buffer.from('\r\n'),
      );
    } else {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escape(field.key)}"\r\n\r\n${field.value ?? ''}\r\n`),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const buffer = Buffer.concat(parts);
  if (buffer.length > maxBytes) throw new ProxyError('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
  return { buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

function encodeBody(method: HttpMethod, body: BodyDto | undefined, maxBytes: number): { buffer: Buffer; contentType: string } | null {
  if (!body || body.mode === 'none' || method === 'HEAD') return null;
  switch (body.mode) {
    case 'json':
      return { buffer: Buffer.from(body.raw ?? '', 'utf8'), contentType: 'application/json' };
    case 'text':
      return { buffer: Buffer.from(body.raw ?? '', 'utf8'), contentType: 'text/plain; charset=utf-8' };
    case 'xml':
      return { buffer: Buffer.from(body.raw ?? '', 'utf8'), contentType: 'application/xml; charset=utf-8' };
    case 'form-urlencoded': {
      const params = new URLSearchParams();
      for (const f of body.fields ?? []) if (f.enabled !== false && f.key.trim()) params.append(f.key, f.value ?? '');
      return { buffer: Buffer.from(params.toString(), 'utf8'), contentType: 'application/x-www-form-urlencoded' };
    }
    case 'multipart':
      return encodeMultipart(body, maxBytes);
  }
}

/** Converts the frontend DTO into the exact request that will be sent upstream. */
export function buildRequest(dto: ExecuteRequestDto, options: BuildOptions): BuiltRequest {
  const url = parseTargetUrl(dto.url);
  const sensitiveParams: string[] = [];
  const { headers, dropped } = filterRequestHeaders((dto.headers ?? []).filter((h) => h.enabled !== false));

  applyAuth(dto.auth, url, headers, sensitiveParams);

  const encoded = encodeBody(dto.method, dto.body, options.maxBodyBytes);
  if (encoded) {
    if (encoded.buffer.length > options.maxBodyBytes) {
      throw new ProxyError('PAYLOAD_TOO_LARGE', `Request body exceeds ${options.maxBodyBytes} bytes`);
    }
    if (!hasHeader(headers, 'content-type') || dto.body?.mode === 'multipart') {
      setHeader(headers, 'Content-Type', encoded.contentType);
    }
  }

  if (!hasHeader(headers, 'user-agent')) headers.push({ key: 'User-Agent', value: options.userAgent });
  if (!hasHeader(headers, 'accept')) headers.push({ key: 'Accept', value: '*/*' });
  if (!hasHeader(headers, 'accept-encoding')) headers.push({ key: 'Accept-Encoding', value: 'gzip, deflate, br' });

  return {
    method: dto.method,
    url,
    headers,
    body: encoded?.buffer ?? null,
    droppedHeaders: dropped,
    sensitiveParams,
  };
}

/** Request headers as reported back to the client, with secrets masked. */
export function maskHeaders(headers: HeaderEntry[]): [string, string][] {
  return headers.map(({ key, value }) => [key, isSensitiveHeader(key) ? maskValue(value) : value]);
}
