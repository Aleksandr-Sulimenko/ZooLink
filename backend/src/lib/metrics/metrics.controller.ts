import { Controller, Get, Header, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { MetricsGuard } from './metrics.guard';
import { MetricsService } from './metrics.service';

// @Public skips the global JWT guard; MetricsGuard then enforces the ops-credential / internal-only
// gate (AUDIT3 security.md — defence-in-depth, do not rely solely on Caddy). @SkipThrottle keeps the
// scrape unthrottled for the scraper that passes the gate.
@Public()
@UseGuards(MetricsGuard)
@ApiExcludeController()
@SkipThrottle()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.metrics();
  }
}
