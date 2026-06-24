import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics on GET /metrics (version-neutral, so the scrape path is stable across API
 * versions). Default Node/process metrics now; domain counters/histograms register in later phases.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
