import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { ProxyError } from '../../proxy/errors/proxy-error.js';

export const ACCESS_TOKEN_HEADER = 'x-api-inspector-token';

/**
 * Prevents the BFF from being used as an open proxy:
 *  - when ALLOWED_ORIGINS is set, browser requests from other origins are rejected;
 *  - when ACCESS_TOKEN is set, every request must present it.
 * Public deployments should additionally sit behind real user authentication.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (origin && this.config.allowedOrigins.length > 0 && !this.config.allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      throw new ProxyError('FORBIDDEN_ORIGIN', `Origin ${origin} is not allowed`);
    }
    if (this.config.accessToken) {
      const provided = req.headers[ACCESS_TOKEN_HEADER];
      const value = Array.isArray(provided) ? provided[0] : provided;
      if (!value || !safeEqual(value, this.config.accessToken)) {
        throw new ProxyError('UNAUTHORIZED', 'Missing or invalid access token');
      }
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
