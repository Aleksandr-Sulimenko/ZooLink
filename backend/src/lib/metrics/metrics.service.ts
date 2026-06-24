import { Injectable, OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';

/** Owns the Prometheus registry. Domain modules register custom metrics against it later. */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  onModuleInit(): void {
    this.registry.setDefaultLabels({ app: 'zoolink-api' });
    collectDefaultMetrics({ register: this.registry });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
