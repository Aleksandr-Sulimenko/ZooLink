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

  sendMessage(msg: MessengerMessage): Promise<MessengerSendResult> {
    this.logger.warn(`[STUB] сообщение в мессенджер не отправлено (chat=${msg.chatId})`);
    return Promise.resolve({ accepted: true, providerMessageId: null });
  }
}
