import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_CONFIG, loadAppConfig } from './app-config.js';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ cache: true, envFilePath: ['.env.local', '.env'] })],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (env: ConfigService) => {
        const config = loadAppConfig((key) => env.get<string>(key));
        if (config.proxy.allowPrivateNetworks) {
          new Logger('Config').warn(
            'PROXY_ALLOW_PRIVATE_NETWORKS=true: private and loopback ranges are reachable. Never use this in a shared deployment.',
          );
        }
        return config;
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigurationModule {}
