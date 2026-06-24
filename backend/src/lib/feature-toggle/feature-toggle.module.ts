import { Global, Module } from '@nestjs/common';
import { FeatureToggleService } from './feature-toggle.service';

/**
 * Cross-cutting feature-toggle gate (ADR-0008). Depends on the global DbModule and
 * AuditModule. Domain code injects {@link FeatureToggleService} to gate capabilities
 * (e.g. payments) without reading the table directly.
 */
@Global()
@Module({
  providers: [FeatureToggleService],
  exports: [FeatureToggleService],
})
export class FeatureToggleModule {}
