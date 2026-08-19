import { Logger } from '@nestjs/common';
import type {
  MessengerMessage,
  MessengerProvider,
  MessengerSendResult,
} from './messenger-provider.port';

/**
 * Заглушка канала сообщений: работает, когда токен бота не настроен, чтобы поток уведомлений
 * не падал в dev и в тестах.
 *
 * ТЕКСТ НЕ ПИШЕТСЯ В ЖУРНАЛ, в отличие от заглушки СМС: у СМС в тексте живёт код подтверждения и
 * без него dev-поток не пройти вручную, а у мессенджера письмо приходит человеку самому — значит
 * печатать содержимое незачем, а один раз напечатанное содержимое живёт в логах дольше, чем нужно.
 */
export class StubMessengerProvider implements MessengerProvider {
  private readonly logger = new Logger('StubMessengerProvider');

  sendMessage(_msg: MessengerMessage): Promise<MessengerSendResult> {
    // ИДЕНТИФИКАТОР ПОЛУЧАТЕЛЯ В ЖУРНАЛ НЕ ИДЁТ — то же правило, что у боевого адаптера
    // (pii.util.ts; соседи по шву маскируют телефон и почту). Заглушка работает в конфигурации ПО
    // УМОЛЧАНИЮ (токен пуст), поэтому здесь это правило нарушалось бы на КАЖДОЙ отправке.
    this.logger.warn(
      '[STUB] сообщение в мессенджер НЕ отправлено: провайдер не настроен (токен пуст)',
    );
    return Promise.resolve({ accepted: true, providerMessageId: null });
  }
}
