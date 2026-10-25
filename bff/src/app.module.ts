import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { ConfigurationModule } from './config/configuration.module.js';
import { AccessGuard } from './common/guards/access.guard.js';
import { HealthController } from './health/health.controller.js';
import { ProxyModule } from './proxy/proxy.module.js';

@Module({
  imports: [
    ConfigurationModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: config.rateLimit.windowMs, limit: config.rateLimit.max }],
    }),
    ProxyModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
