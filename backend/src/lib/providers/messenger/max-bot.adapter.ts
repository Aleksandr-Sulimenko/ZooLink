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
  /** Явный отказ площадки ПРИ КОДЕ 200 — замерено сырым телом 17.08.2026 (находка №24). */
  success?: boolean;
  message?: { body?: { mid?: string } };
}

const ENDPOINT = 'https://platform-api2.max.ru/messages';

/**
 * MAX Bot API — канал сообщений (ADR-0008, добавлен по слову владельца 13.08.2026).
 *
 * ОТКУДА ВЗЯТА ФОРМА ВЫЗОВА И ЧТО ИЗ НЕЁ ПОДТВЕРЖДЕНО ЖИВЫМ ЗАМЕРОМ (обновлено 17.08.2026):
 * база `platform-api2.max.ru`, токен в заголовке `Authorization`, отправка `POST /messages` взяты
 * из НАШЕГО паспорта `design/product-passports/passport-kwork-6-max-bot.md` (заявлен прогон
 * 17.07.2026) — НАМИ не проверялись ни разу.
 * ЗАМЕРЕНО ТРЕКОМ ДРУЗЕЙ 17.08.2026 НА ХОСТЕ `botapi.max.ru` (радиус подтверждения — РОВНО ОДИН
 * замеренный объект, на наш хост это НЕ переносится): `POST /messages?chat_id=N` с телом
 * `{"text":"…"}` принимается; ответ несёт `message.body.mid` ВСЕГДА при успехе; заголовок идёт
 * БЕЗ префикса `Bearer`; предел текста 4000 знаков.
 * 🔴 ОПРОВЕРГНУТО ТЕМ ЖЕ ЗАМЕРОМ — прежняя клауза «неверная форма даёт видимый отказ вендора»:
 * площадка отвечает HTTP 200 с телом `{"success":false}`. Код ответа НЕ является свидетельством
 * приёма, поэтому ниже мы судим по ДВУМ свидетелям тела (`success` и наличие `mid`).
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
      // «ЛЮБОЙ 200 = ПРИНЯТО» ЛОМАЕТСЯ НА ЖИВОМ ОТВЕТЕ ПЛОЩАДКИ — это ЗАМЕР, а не осторожность
      // (находка №24, крит; сырое тело от трека друзей 17.08): DELETE с чужим идентификатором дал
      // HTTP 200 и тело {"success":false,"message":"Invalid chatId: 0"}. Значит код ответа НЕ
      // является свидетельством приёма, и путь достижим одной опечаткой в идентификаторе чата.
      // Судим по ДВУМ свидетелям тела: явному отказу `success:false` и наличию `mid` (замерено:
      // при успехе поле есть ВСЕГДА).
      // ФОРМА ТЕЛА ПРОВЕРЯЕТСЯ ДО ЧТЕНИЯ ПОЛЕЙ. Замерено на круге 2 (два лейна независимо): тело
      // `null` — валидный JSON, и прежнее `data.success` роняло адаптер сырым TypeError, который
      // уходил МИМО ProviderError и превращался в 500 со стеком вместо 503. Это мина, взведённая
      // предыдущим лечением: до него читалось только `data.message?.body?.mid`, и `null` проходил.
      // Массив тоже отвергаем: `typeof [] === 'object'`, и без этой половины правило вышло бы
      // НЕРОВНЫМ — строка и число падали бы, а массив тихо проходил в ветку чтения полей. Поймано
      // собственной осью при её написании: тест на `[]` покраснел, и это правильнее, чем подогнать
      // ожидание под код.
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new ProviderError(
          'max',
          'response',
          'ответ площадки не является объектом — форма ответа не та, приём НЕ подтверждён',
        );
      }
      if (data.success === false) {
        throw new ProviderError(
          'max',
          'response',
          'площадка ответила 200, но отказом (success:false) — сообщение НЕ принято',
        );
      }
      // `mid` берётся ТОЛЬКО строкой: чужой JSON может принести число, массив или объект, а порт
      // объявляет providerMessageId как string|null. Иначе в домен уедет значение, не являющееся тем,
      // чем оно объявлено (находка круга 2, вес низкий: потребителя порта сегодня нет).
      const rawMid: unknown = data.message?.body?.mid;
      const mid = typeof rawMid === 'string' && rawMid !== '' ? rawMid : null;
      if (mid === null) {
        // Не бросаем: форма ответа подтверждена ЖИВЫМ вызовом лишь для botapi.max.ru, а наш хост
        // (platform-api2.max.ru) не проверен никем — молча объявлять чужой ответ провалом значило
        // бы заменить одну недоказанную уверенность другой. Но и «принято» тут сказать нельзя.
        this.logger.warn(
          'MAX: ответ 200 без message.body.mid — приём НЕ подтверждён; форма ответа этого хоста ' +
            'не проверялась живым вызовом (находка №24 ре-гейта)',
        );
      }
      // В ЖУРНАЛ НЕ ПИШЕМ НИ chat_id, НИ mid. Первый — прямой идентификатор получателя (правило
      // pii.util.ts, которое чтут оба соседних адаптера: maskPhone/maskEmail). Второй — НЕ
      // непрозрачен: замер друзей 17.08 показал, что площадка достаёт из mid идентификатор чата
      // («Invalid chatId: 0» на выдуманном mid), то есть mid несёт того же адресата ВТОРЫМ,
      // неявным экземпляром. Замазать один и оставить другой = ложная уверенность.
      this.logger.log(`MAX message sent (accepted=${mid !== null})`);
      return { accepted: mid !== null, providerMessageId: mid };
    } catch (err) {
      throw this.безСекрета(translateCertificateFailure(err));
    }
  }

  /**
   * ВТОРОЙ СЛОЙ ПРОТИВ УТЕЧКИ ТОКЕНА (крит круга 5). Первый слой — отказ на старте при управляющем
   * знаке в MAX_BOT_TOKEN (env.validation.ts) — закрывает ИЗВЕСТНЫЙ путь: undici эхом возвращает
   * значение заголовка в тексте ошибки. Но `err.message` есть ПРОИЗВОЛЬНАЯ строка рантайма, о
   * содержимом которой мы не знаем ничего, и завтрашняя версия зависимости может вернуть секрет
   * иным путём. Перечислять пути — это ловить ПРИЗНАКИ; здесь мы закрываем СПОСОБНОСТЬ.
   *
   * ПОЧЕМУ ИМЕННО ЗДЕСЬ, А НЕ В ДВЕРИ: `http.util.ts` токена НЕ ЗНАЕТ и знать не должен —
   * ему пришлось бы УГАДЫВАТЬ секрет регэкспом, а замазывание регэкспом над свободным текстом
   * структурно неполно (замерено у нас же). Адаптер секретом ВЛАДЕЕТ, поэтому сверяет ТОЧНЫМ
   * совпадением, без догадок: КТО ВЛАДЕЕТ СЕКРЕТОМ, ТОТ И ОТВЕЧАЕТ ЗА ЕГО НЕВЫНОС.
   *
   * ЧЕГО ЭТО НЕ ДЕЛАЕТ, ГОВОРЮ ВСЛУХ: не защищает от ЧАСТИ токена в сообщении (обрезанного,
   * перекодированного, поэлементно экранированного) — точное совпадение такого не увидит.
   * Против этого работает первый слой; здесь честная страховка, а не полный замок.
   */
  private безСекрета(err: unknown): unknown {
    if (!this.botToken || !(err instanceof ProviderError)) return err;
    if (!err.message.includes(this.botToken)) return err;
    return new ProviderError(
      err.provider,
      err.kind,
      err.message.split(this.botToken).join('<СЕКРЕТ ВЫРЕЗАН: MAX_BOT_TOKEN>'),
      err.cause,
      err.code,
      err.mayHaveArrived,
    );
  }
}

/**
 * РАЗРЕШЁННЫЙ ХОСТ ≠ РАБОТАЮЩИЙ КАНАЛ, и без этой функции причина выглядела бы как «сеть».
 * ⚠️ СВОЙСТВО ПРИНАДЛЕЖИТ ХОСТУ, А НЕ «ДОМЕНУ MAX» — замерено 17.08.2026 треком дохода, три хоста
 * в двух режимах доверия: `platform-api2.max.ru` (наш) работает ТОЛЬКО с российским корнем;
 * `botapi.max.ru` и `platform-api.max.ru` — на СИСТЕМНЫХ корнях, и русский корень им НЕ НУЖЕН И
 * ВРЕДЕН (при подсунутом как единственный отвалились оба). Поэтому совет ниже верен ровно для
 * хоста в `ENDPOINT` и ровно на дату замера; при смене хоста его надо перемерить, а не перенести.
 * `platform-api2.max.ru` подписан сертификатом НУЦ Минцифры, которого НЕТ в обычных хранилищах: нашему
 * python-боту понадобился бандл `russian_trusted_ca.pem`. В Node то же самое проявится как код
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` внутри общей транспортной ошибки —
 * человек пойдёт искать сеть, файрвол и падение вендора, а дело в ДОВЕРИИ К СЕРТИФИКАТУ.
 *
 * РАЗЛИЧАЕМ ПО КОДУ РАНТАЙМА, НЕ ПО ПОДСТРОКЕ. Замерено на живом undici: причина отказа лежит НЕ в
 * `message` (там всегда «fetch failed»), а в цепочке `cause` как `.code` — `http.util.ts` уже достаёт
 * его в `ProviderError.code`. Прежняя проверка `message.includes('cert')` не срабатывала НИКОГДА и
 * при этом была бы слишком широкой: `ERR_TLS_CERT_ALTNAME_INVALID` (несовпадение имени — ровно то,
 * что делает активный MITM) и `CERT_HAS_EXPIRED` — это ДРУГОЙ диагноз, и советовать «досыпь доверия»
 * в момент атаки на доверие — худшее, что может сказать текст отказа. Поэтому совет про российский
 * корень даётся ТОЛЬКО на коды «нет якоря доверия»; истёкший/несовпавший — отказ БЕЗ такого совета.
 */
const MISSING_TRUST_ANCHOR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
]);
const OTHER_CERT_CODES = new Set(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return 'н/д';
  }
}

function translateCertificateFailure(err: unknown): unknown {
  if (!(err instanceof ProviderError) || err.kind !== 'network' || err.code == null) return err;

  if (MISSING_TRUST_ANCHOR_CODES.has(err.code)) {
    return new ProviderError(
      'max',
      'config',
      `MAX отказал НЕ по сети, а по ДОВЕРИЮ К СЕРТИФИКАТУ (${err.code}) на хосте ${hostOf(ENDPOINT)}. ` +
        'ДВА ПРОЧТЕНИЯ, и выбрать обязан человек: (1) хост подписан НУЦ Минцифры, которого нет в ' +
        'хранилище по умолчанию — так замерено 17.08.2026 для platform-api2.max.ru; (2) соединение ' +
        'ПЕРЕХВАЧЕНО — обычный MITM даёт ТОТ ЖЕ класс кодов. Прежде чем добавлять корень, сверьте ' +
        'издателя и отпечаток предъявленного сертификата. Если хост сменили — перемерьте: у ' +
        'botapi.max.ru издатель обычный, и русский корень там ЛОМАЕТ доверие. Добавлять корень — ' +
        'узким бандлом на ЭТОТ вызов, а не NODE_EXTRA_CA_CERTS на весь процесс (он расширит доверие ' +
        'для БД, кэша, хранилища и всех вендоров разом).',
      err,
      err.code,
    );
  }

  if (OTHER_CERT_CODES.has(err.code)) {
    return new ProviderError(
      'max',
      'config',
      `MAX отказал по СЕРТИФИКАТУ (${err.code}) — но это НЕ отсутствие российского корня, и ` +
        'досыпать доверия здесь НЕЛЬЗЯ: истёкший срок или несовпадение имени может означать ' +
        'подмену соединения. Проверить дату/имя сертификата вендора, доверие рантайма не трогать.',
      err,
      err.code,
    );
  }

  return err;
}
