import type { ProxyErrorKind } from './errors/proxy-error.js';
import type { ResponseCookie } from './http/cookies.js';
import type { Timings } from './http/http-executor.js';

/** Envelope returned when the target API produced an HTTP response (any status). */
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
  response: {
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
  };
  timings: Timings;
  virtual: boolean;
}

/** Envelope returned for transport / policy errors (no HTTP response from the target). */
export interface ProxyFailure {
  ok: false;
  startedAt: string;
  error: {
    kind: ProxyErrorKind;
    message: string;
    statusCode: number;
    details?: Record<string, unknown>;
  };
  timings?: { total: number };
}
