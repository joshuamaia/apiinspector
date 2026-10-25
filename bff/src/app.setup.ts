import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { ACCESS_TOKEN_HEADER } from './common/guards/access.guard.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

/** Applies HTTP-level configuration. Shared by `main.ts` and the integration tests. */
export function configureApp(app: NestExpressApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api');
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  // File uploads travel as base64 inside JSON (~33% overhead).
  app.useBodyParser('json', { limit: Math.ceil(config.proxy.maxRequestBodyBytes * 1.4) });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  if (config.allowedOrigins.length > 0) {
    app.enableCors({
      origin: config.allowedOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', ACCESS_TOKEN_HEADER],
      credentials: false,
      maxAge: 600,
    });
  }
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  return config;
}
