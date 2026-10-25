import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller.js';
import { DNS_RESOLVER, ProxyService } from './proxy.service.js';
import { defaultResolver } from './security/safe-lookup.js';

@Module({
  controllers: [ProxyController],
  providers: [ProxyService, { provide: DNS_RESOLVER, useValue: defaultResolver }],
})
export class ProxyModule {}
