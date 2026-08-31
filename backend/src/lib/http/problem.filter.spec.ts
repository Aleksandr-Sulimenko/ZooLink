import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ProblemExceptionFilter } from './problem.filter';
import { ProviderError } from '../providers/provider-error';
import { Sentry } from '../observability/sentry';
import type { ProviderFailureMetrics } from '../providers/provider-failure.metrics';

function makeHost() {
  const json = jest.fn();
  const setHeader = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ setHeader, json });
  const res = { status, setHeader, json, getHeader: jest.fn().mockReturnValue('req-123') };
  // Fixture URL only — NOT an assertion about the API base path. The public base is the single source
  // config/api-base.ts (`/api/v1`); this mock req is never routed, so its value is arbitrary.
  const req = { method: 'GET', originalUrl: '/v1/listings' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  // status() returns the object holding setHeader/json:
  status.mockReturnValue({ setHeader: setHeader.mockReturnThis(), json });
  return { host, status, json };
}

describe('ProblemExceptionFilter', () => {
  it('maps a ProviderError to 503 UPSTREAM_UNAVAILABLE without leaking the provider message', () => {
    const { host, status, json } = makeHost();
    const filter = new ProblemExceptionFilter();

    filter.catch(
      new ProviderError('smsru', 'http', 'HTTP 500 secret-token=abc123 leaked body'),
      host,
    );

    expect(status).toHaveBeenCalledWith(503);
    const body = json.mock.calls[0][0] as { code: string; detail: string; status: number };
    expect(body.status).toBe(503);
    expect(body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.detail).not.toContain('secret-token');
    expect(body.detail).not.toContain('abc123');
    expect(body.detail).toMatch(/upstream service/i);
  });

  it('still maps HttpExceptions normally (regression guard)', () => {
    const { host, status, json } = makeHost();
    const filter = new ProblemExceptionFilter();

    filter.catch(new BadRequestException({ message: 'bad', code: 'VALIDATION_ERROR' }), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0] as { code: string; detail: string };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.detail).toBe('bad');
  });
});

/**
 * ═══ РОД ОТКАЗА ДОЖИВАЕТ ДО ПРИБОРОВ ДЕЖУРНОГО (страж находки №145) ═══
 *
 * Было: один logger.error и один 503 на все четыре рода; Sentry — только для «неожиданной
 * ошибки»; метрик у исходящих ноль. Значит откат двери, адаптер мимо перечня и смена хоста
 * вендором выглядели на ВСЕХ приборах как «вендор прилёг», и дежурный ждал бы.
 */
describe('ProviderError: род отказа виден снаружи (№145)', () => {
  // Хост берём ТОЙ ЖЕ фабрикой, что и соседние оси этого свода: своя копия мока разошлась бы с
  // ней молча (наш класс «общий эталон зеленеет, пока обе стороны ошибаются одинаково»).
  const ctx = (): ArgumentsHost => makeHost().host;

  it('🔴 счётчик получает ОБЕ метки: кто вендор и ЧЕЙ это отказ', () => {
    // МУТАНТ (красное-до): убрать вызов record — ось краснеет, и вместе с ней исчезает
    // единственный прибор, отличающий «сломан наш периметр» от «лежит вендор».
    const записи: { provider: string; kind: string }[] = [];
    // Подделка счётчика типизирована ЧЕСТНО, без as-обхода: фильтр принимает объект с методом
    // record, и ось обязана это доказывать типом, а не подавлять проверку.
    const метрики: Pick<ProviderFailureMetrics, 'record'> = {
      record: (p, k) => void записи.push({ provider: p, kind: k }),
    };
    const f = new ProblemExceptionFilter(метрики);
    f.catch(new ProviderError('sms.ru', 'config', 'хост вне перечня'), ctx());
    f.catch(new ProviderError('max', 'network', 'таймаут'), ctx());
    expect(записи).toEqual([
      { provider: 'sms.ru', kind: 'config' },
      { provider: 'max', kind: 'network' },
    ]);
  });

  it('🔴 kind=config БУДИТ Sentry — это ПОСТОЯННЫЙ отказ нашей конфигурации', () => {
    // МУТАНТ: снять ветку Sentry — ось краснеет. Ждать вендора при config бесполезно, а выглядит
    // это как вендорская сетевая шумиха.
    const шпион = jest.spyOn(Sentry, 'captureException').mockImplementation(() => '');
    try {
      new ProblemExceptionFilter().catch(
        new ProviderError('sms.ru', 'config', 'хост вне перечня'),
        ctx(),
      );
      expect(шпион).toHaveBeenCalledTimes(1);
      const теги = (шпион.mock.calls[0][1] as { tags: Record<string, string> }).tags;
      expect(теги.provider).toBe('sms.ru');
      expect(теги.providerErrorKind).toBe('config');
    } finally {
      шпион.mockRestore();
    }
  });

  it('🔴 ОБРАТНЫЙ ПОЛЮС: отказ ВЕНДОРА Sentry НЕ будит — иначе тревога станет шумом и её замьютят', () => {
    const шпион = jest.spyOn(Sentry, 'captureException').mockImplementation(() => '');
    try {
      for (const kind of ['network', 'http', 'response'] as const) {
        new ProblemExceptionFilter().catch(new ProviderError('max', kind, 'вендор'), ctx());
      }
      expect(шпион).not.toHaveBeenCalled();
    } finally {
      шпион.mockRestore();
    }
  });

  it('без реестра метрик фильтр РАБОТАЕТ (способность не отнята) — счётчик просто молчит', () => {
    expect(() =>
      new ProblemExceptionFilter().catch(new ProviderError('max', 'network', 'x'), ctx()),
    ).not.toThrow();
  });
});
