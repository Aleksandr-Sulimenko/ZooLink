import { Logger } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { Module as ContainerModule } from '@nestjs/core/injector/module';
import { Registry } from 'prom-client';
import { AuditMetrics } from './audit.metrics';
import { MetricsService } from '../metrics/metrics.service';

/** A graph stub that says whether THIS process provides a MetricsService (the only thing read). */
function graphWith(providers: unknown[]): ModulesContainer {
  const providerMap = new Map(providers.map((p) => [p, {}]));
  return new ModulesContainer([
    ['stub-module', { providers: providerMap } as unknown as ContainerModule],
  ]);
}

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
    expect(audit.isWired).toBe(true);
  });

  it('is a no-op (does not throw) when no MetricsService is present (worker context)', () => {
    const audit = new AuditMetrics(undefined);
    expect(() => audit.record('feature_toggle.flip', 'HUMAN')).not.toThrow();
    expect(audit.isWired).toBe(false);
  });

  /**
   * The second lock of AUDIT5 mini-pack A. The counter was dead from birth for one reason: a missing
   * @Optional() dependency and a correctly wired one looked EXACTLY the same from outside. Bootstrap
   * must therefore say which case it is, and must distinguish "no registry in this process" (a worker
   * — legal) from "a registry exists here and I still did not get it" (the defect).
   */
  describe('bootstrap announcement (degradation is never silent)', () => {
    let error: jest.SpyInstance;
    let log: jest.SpyInstance;

    beforeEach(() => {
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('logs an ERROR when the process HAS a registry but this provider did not get it', () => {
      new AuditMetrics(undefined, graphWith([MetricsService])).onApplicationBootstrap();

      expect(error).toHaveBeenCalledTimes(1);
      const message = String(error.mock.calls[0][0]);
      expect(message).toContain('zoolink_audit_actions_total');
      expect(message).toContain('DOES provide a Prometheus registry');
      expect(log).not.toHaveBeenCalled();
    });

    it('logs an informational note (NOT an error) when the process has no registry at all', () => {
      new AuditMetrics(undefined, graphWith([])).onApplicationBootstrap();

      expect(error).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('no Prometheus registry');
    });

    it('says nothing when the counter is wired', () => {
      const metrics = { registry: new Registry() } as unknown as MetricsService;
      new AuditMetrics(metrics, graphWith([MetricsService])).onApplicationBootstrap();

      expect(error).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
  });
});
