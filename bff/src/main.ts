import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  const config = configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API Inspector BFF listening on port ${config.port}`);
}
await bootstrap();
