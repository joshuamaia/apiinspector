import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
