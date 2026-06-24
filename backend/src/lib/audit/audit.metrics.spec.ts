import { Registry } from 'prom-client';
import { AuditMetrics } from './audit.metrics';
import type { MetricsService } from '../metrics/metrics.service';

describe('AuditMetrics', () => {
  it('records the action counter labelled by principal_type when metrics are available', async () => {
    const registry = new Registry();
    const metrics = { registry } as unknown as MetricsService;
    const audit = new AuditMetrics(metrics);

    audit.record('listing.approve', 'HUMAN');
    audit.record('listing.approve', 'AGENT');
    audit.record('listing.approve', 'AGENT');

    const human = await registry.getSingleMetricAsString('zoolink_audit_actions_total');
    expect(human).toContain('principal_type="HUMAN",action="listing.approve"} 1');
    expect(human).toContain('principal_type="AGENT",action="listing.approve"} 2');
  });

  it('is a no-op (does not throw) when no MetricsService is present (worker context)', () => {
    const audit = new AuditMetrics(undefined);
    expect(() => audit.record('feature_toggle.flip', 'HUMAN')).not.toThrow();
  });
});
