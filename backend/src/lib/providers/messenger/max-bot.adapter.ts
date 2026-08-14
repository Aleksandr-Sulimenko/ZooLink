import { Logger } from '@nestjs/common';
import { fetchJson } from '../http.util';
import { ProviderError } from '../provider-error';
import type {
  MessengerMessage,
  MessengerProvider,
  MessengerSendResult,
} from './messenger-provider.port';

/** Ответ MAX Bot API на отправку, из которого нам нужен только идентификатор сообщения. */
interface MaxSendResponse {
  message?: { body?: { mid?: string } };
}

const ENDPOINT = 'https://platform-api2.max.ru/messages';

/**
 * MAX Bot API — канал сообщений (ADR-0008, добавлен по слову владельца 13.08.2026).
 *
 * ОТКУДА ВЗЯТА ФОРМА ВЫЗОВА, И ЧЕГО Я НЕ ПРОВЕРЯЛА — говорю прямо, чтобы никто не принял это за
 * измеренное мной: база `platform-api2.max.ru`, токен в заголовке `Authorization`, отправка
 * `POST /messages` — из НАШЕГО паспорта продукта `design/product-passports/passport-kwork-6-max-bot.md`,
 * где заявлен живой прогон 17.07.2026 (echo-бот ответил владельцу, HTTP 200). Сам прогон я не
 * повторяла и к докам вендора не обращалась. Поэтому ТОЧНАЯ ФОРМА ТЕЛА ЗАПРОСА И ОТВЕТА — гипотеза,
 * и первый живой вызов обязан её подтвердить ДО включения канала кому-либо наружу.
 * Направление ошибки безопасное: неверная форма даёт видимый отказ вендора, а не тихую утечку.
 *
 * ЧТО ЗДЕСЬ ЛУЧШЕ, ЧЕМ У СОСЕДЕЙ ПО ШВУ: у СМС и геокодера ключ живёт в АДРЕСНОЙ СТРОКЕ (требование
 * тех вендоров), поэтому URL сам является секретом. MAX принимает токен ЗАГОЛОВКОМ — значит секрета
 * в адресе нет вовсе, и его нельзя обронить в журнал вместе с URL. Мы этим пользуемся сознательно.
 */
export class MaxBotAdapter implements MessengerProvider {
  private readonly logger = new Logger(MaxBotAdapter.name);

  constructor(private readonly botToken: string) {}

  async sendMessage(msg: MessengerMessage): Promise<MessengerSendResult> {
    // chat_id — в строке запроса (так адресует сам вендор), ТОКЕН — заголовком: в URL секрета нет.
    const url = `${ENDPOINT}?chat_id=${encodeURIComponent(msg.chatId)}`;
    try {
      const data = await fetchJson<MaxSendResponse>('max', url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: msg.text }),
      });
      const mid = data.message?.body?.mid ?? null;
      // В журнал — только факт и идентификатор чата: ни текста (там бывает код), ни токена.
      this.logger.log(`MAX message accepted (chat=${msg.chatId}, mid=${mid ?? 'n/a'})`);
      return { accepted: true, providerMessageId: mid };
    } catch (err) {
      throw translateCertificateFailure(err);
    }
  }
}

/**
 * РАЗРЕШЁННЫЙ ХОСТ ≠ РАБОТАЮЩИЙ КАНАЛ, и без этой функции причина выглядела бы как «сеть».
 * `max.ru` подписан сертификатом НУЦ Минцифры, которого НЕТ в обычных хранилищах доверия: нашему
 * python-боту понадобился бандл `russian_trusted_ca.pem`. В Node то же самое проявится как
 * «unable to verify the first certificate» внутри общей транспортной ошибки — то есть человек
 * пойдёт искать сеть, файрвол и падение вендора, а дело в ДОВЕРИИ К СЕРТИФИКАТУ.
 * Поэтому такой отказ переводится в диагноз, который называет причину и лечение.
 */
function translateCertificateFailure(err: unknown): unknown {
  if (!(err instanceof ProviderError) || err.kind !== 'network') return err;
  const reason = err.message.toLowerCase();
  const certish =
    reason.includes('unable to verify') ||
    reason.includes('self-signed') ||
    reason.includes('self signed') ||
    reason.includes('unable_to_get_issuer') ||
    reason.includes('cert');
  if (!certish) return err;
  return new ProviderError(
    'max',
    'config',
    'MAX отказал НЕ по сети, а по ДОВЕРИЮ К СЕРТИФИКАТУ: домен подписан НУЦ Минцифры, которого нет ' +
      'в хранилище доверия по умолчанию. Лечение — дать рантайму российский корневой сертификат ' +
      '(NODE_EXTRA_CA_CERTS=<путь к russian_trusted_ca.pem> либо образ с этим бандлом). ' +
      'Искать падение сети или вендора здесь не нужно.',
    err,
  );
}
