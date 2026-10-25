import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DEMO_BASE_URL } from '../demo/demo-api.js';
import { ExecuteRequestDto, HTTP_METHODS } from './dto/execute-request.dto.js';
import { ProxyService } from './proxy.service.js';
import type { ProxySuccess } from './proxy.types.js';

@Controller('proxy')
export class ProxyController {
  constructor(
    private readonly proxy: ProxyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('execute')
  @HttpCode(200)
  execute(@Body() dto: ExecuteRequestDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<ProxySuccess> {
    // Propagate client cancellation (browser AbortController) to the upstream request.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    return this.proxy.execute(dto, { clientKey: req.ip ?? 'unknown', signal: controller.signal });
  }

  /** Public limits so the UI can explain constraints to the user. */
  @Get('limits')
  limits() {
    const { proxy } = this.config;
    return {
      methods: HTTP_METHODS,
      timeoutMs: proxy.timeoutMs,
      maxTimeoutMs: proxy.maxTimeoutMs,
      maxResponseBytes: proxy.maxResponseBytes,
      maxRequestBodyBytes: proxy.maxRequestBodyBytes,
      maxRedirects: proxy.maxRedirects,
      maxConcurrencyPerClient: proxy.maxConcurrencyPerClient,
      allowPrivateNetworks: proxy.allowPrivateNetworks,
      demoApi: this.config.demoApiEnabled ? DEMO_BASE_URL : null,
    };
  }
}
