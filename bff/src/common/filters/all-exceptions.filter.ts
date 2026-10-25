import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { ProxyError, type ProxyErrorKind } from '../../proxy/errors/proxy-error.js';
import type { ProxyFailure } from '../../proxy/proxy.types.js';

/** Normalizes every error into the `ProxyFailure` envelope without leaking internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent || res.writableEnded) return;
    const error = this.normalize(exception);
    const body: ProxyFailure = { ok: false, startedAt: new Date().toISOString(), error };
    res.status(error.statusCode).json(body);
  }

  private normalize(exception: unknown): ProxyFailure['error'] {
    if (exception instanceof ProxyError) {
      return { kind: exception.kind, message: exception.message, statusCode: exception.statusCode, details: exception.details };
    }
    if (exception instanceof ThrottlerException) {
      return { kind: 'RATE_LIMITED', message: 'Rate limit exceeded. Slow down and try again shortly.', statusCode: 429 };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as { message?: string | string[] } | string;
      const raw = typeof response === 'string' ? response : response.message;
      const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? exception.message);
      const kind: ProxyErrorKind =
        status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN_ORIGIN' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'INTERNAL' : 'VALIDATION';
      return { kind, message, statusCode: status };
    }
    const typeError = exception as { type?: string; status?: number };
    if (typeError?.type === 'entity.too.large') {
      return { kind: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large', statusCode: 413 };
    }
    if (typeError?.type === 'entity.parse.failed') {
      return { kind: 'VALIDATION', message: 'Malformed JSON payload', statusCode: 400 };
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return { kind: 'INTERNAL', message: 'Unexpected internal error', statusCode: 500 };
  }
}
