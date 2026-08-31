import { z } from 'zod';

/**
 * ADR-0017 (RF data residency; ФЗ-152 ст.18 ч.5) — the SINGLE canonical allowlist of approved
 * RF region identifiers. Every region-bearing env var (today `S3_REGION`; forward: any `*_REGION`
 * for managed-PG / replica / backup / DR-failover / PII-bearing log sink) must resolve to one of
 * these, or the process refuses to boot. This is layer 1 of the 3-layer residency guardrail
 * (layer 2 = the blocking CI residency gate, which derives its list from THIS constant so the two
 * never diverge; layer 3 = the documented region-pin in deployment_specification.md).
 *
 * Identifiers derive from the ADR-0008 provider (Yandex Cloud, `ru-central1*`). A region *string*
 * is a config-hygiene guard, NOT proof of physical location — it layers on top of provider choice,
 * it does not replace it. TODO(legal): confirm the exact approved zone set (уточнить с legal).
 */
export const RF_ALLOWED_REGIONS = Object.freeze([
  'ru-central1',
  'ru-central1-a',
  'ru-central1-b',
  'ru-central1-c',
  'ru-central1-d',
] as const);

export function isRfRegion(value: string): boolean {
  return (RF_ALLOWED_REGIONS as readonly string[]).includes(value);
}

/**
 * ДВЕРЬ ПЕРЕЧНЕЙ ХОСТОВ — единственное место, где из списка выбрасываются пустые и пробельные
 * элементы. Решение держателя 24.08.2026 по находке №119, и оно шире самой находки: лечить
 * ЧИТАТЕЛЯ значит чинить список, а не его читателя, — второй, третий и будущий пятый едок
 * рождаются дырявыми (класс сработал у флота трижды за день 24.08).
 *
 * ЧЕМ ОПАСЕН ПУСТОЙ ЭЛЕМЕНТ. Он не «ни с чем не совпадает», он СОВПАДАЕТ СО ВСЕМ:
 * `'evil.example.com'.endsWith('')` === true. В bash тот же класс виден глазами как звёздочка
 * (`*""` — это `*`, см. check-rf-residency.sh:403, вылечено 17.08), а в JS вырождение НЕ ВИДНО
 * в тексте вовсе — сопоставитель не строит никакого шаблона и всё равно отвечает «да» на пустоте.
 * Замер до лечения (мутант: '' первым элементом перечня суффиксов): `evil.example.com` и
 * `s3.us-west-004.backblazeb2.com` объявлялись РЕЗИДЕНТНЫМИ. IP-литералы при этом отвергались —
 * их отсекает правило выше, поэтому «резидентным становится ЛЮБОЙ хост» было бы шире факта:
 * любой ДОМЕННЫЙ, но не любой адрес.
 *
 * Сегодня перечни ниже — константы, и пустой строки в них нет: дверь стоит НЕ против сегодняшнего
 * состояния, а против одной строки правки, которая отделяет «не несёт» от «несёт». Если завтра
 * перечень начнёт приходить из данных, править читателей не придётся — дверь уже здесь.
 * Ось на саму дверь: env.validation.spec, «пустой элемент не делает резидентность всеобщей».
 */
export function sanitizedHostList(items: readonly string[]): readonly string[] {
  return Object.freeze(items.map((s) => s.trim()).filter((s) => s.length > 0));
}

/**
 * ADR-0017 (clauses 1, 4 and 6 — the primary PII store, PII-bearing object storage, and observability
 * sinks are all RF-resident) — the SINGLE canonical allowlist of DNS suffixes ANY host-bearing config
 * value may carry.
 * Same shape and same role as RF_ALLOWED_REGIONS above: a code constant, NOT an env var, and layer 2
 * (the CI residency gate) parses THIS list so the two can never diverge.
 *
 * It is deliberately ONE list for the whole class, not one per variable: the recurring defect here is
 * that "the gate checks REGIONS while the data leaves by HOST" (found first on SENTRY_DSN, then again
 * on S3_ENDPOINT and MEDIA_CDN_HOST). Two suffix lists would be two things to keep in step; a second
 * list that quietly grows a `.by` entry is exactly the drift this constant exists to prevent.
 *
 * WHY a code constant and not a `*_ALLOWED_HOSTS` env var: the thing being guarded and the guard
 * would then live in the SAME file. Whoever edits `.env` to point a sink or a bucket at a foreign
 * host edits the allowlist in the next line — a guard the attacker/operator can widen is not a guard,
 * and the CI gate (which reads env files) would read the widened list as authoritative.
 * RF_ALLOWED_REGIONS is deliberately un-overridable for exactly this reason; the host rules are
 * symmetric.
 *
 * A `.ru` domain is no more proof of physical location than a region string is (same caveat as
 * RF_ALLOWED_REGIONS) — it is a config-hygiene guard layered on top of the provider choice, and its
 * real job is to make the realistic accidents impossible: pasting a foreign Sentry-SaaS ingest
 * (`*.ingest.sentry.io`), a foreign bucket (`s3.us-west-004.backblazeb2.com`) or a foreign CDN
 * (`cdn.cloudflare.com`) into `.env`. `.рф` is listed in both its Unicode and punycode form because
 * `new URL()` normalises to punycode while the CI gate matches the raw text of a config file.
 */
export const RF_ALLOWED_HOST_SUFFIXES = sanitizedHostList([
  '.ru',
  '.su',
  '.рф',
  '.xn--p1ai',
]);

/**
 * ADR-0017 п.4 — EXACT hostnames of RF-resident STORAGE/CDN providers whose FQDN does not sit under
 * an RF TLD, so the suffix rule above cannot see them. Today exactly one entry, and it is not
 * optional: `storage.yandexcloud.net` is the Yandex Object Storage endpoint chosen in ADR-0008 and
 * named as the prod object store in `.env.example` — a suffix-only rule would have rejected our OWN
 * documented production configuration (a lock that removes a capability, not one that checks a form).
 *
 * Matched as "host === entry OR host ends with `.` + entry", so the virtual-host bucket form
 * (`zoolink-media.storage.yandexcloud.net`) is admitted while a look-alike
 * (`storage.yandexcloud.net.evil.com`) is not. Any OTHER provider is a deliberate review: adding a
 * host here is a code change that goes through the ADR/security gate, which is the entire point of
 * keeping the list out of `.env`.
 */
export const RF_ALLOWED_STORAGE_HOSTS = sanitizedHostList(['storage.yandexcloud.net']);

/**
 * ИСХОДЯЩИЙ ПЕРИМЕТР: адреса провайдеров, ЗАШИТЫЕ В КОД адаптеров (ADR-0008). До 13.08.2026 они были
 * невидимы для гейта резидентности ПО ПОСТРОЕНИЮ: гейт читает переменные окружения, а эти адреса
 * живут в исходниках — значит новый адаптер с зарубежным хостом прошёл бы молча, и узнали бы мы об
 * этом не от прибора, а случайно.
 *
 * Сегодняшние три (проверено чтением кода 13.08.2026 — все ЗАПРОСЫ ПРОВАЙДЕРОВ идут через
 * единственный `fetch` в `lib/providers/http.util.ts`):
 * 🔶 УТВЕРЖДЕНИЕ СУЖЕНО ДО ЗАМЕРЕННОГО (находка №122): здесь стояло «иных исходящих клиентов в
 * backend/src нет» — ложно с самого начала (`@sentry/node` открывает сокет своим транспортом).
 * Перечень вторых дверей ведёт ПРИБОР — `SECOND_DOORS` в `scripts/check-rf-residency.sh`.
 *  · `sms.ru` — туда уходит телефон в E.164 и ТЕКСТ СМС, включая одноразовый код;
 *  · `api.unisender.com` — email и тело письма. Российский провайдер под НЕ-РФ доменом: правило
 *    «только .ru» отвергло бы наш же рабочий конфиг (тот же капкан, что с боевым бакетом Яндекса);
 *  · `geocode-maps.yandex.ru` — адресная строка, которая может быть локацией продавца.
 *
 * Утечки на 13.08 НЕТ: все три провайдера российские. Это слепое место, а не нарушение — и замок
 * ставится ради КЛАССА, а не ради трёх случаев.
 */
// Рождение — через ДВЕРЬ ПЕРЕЧНЕЙ (находка №170: лечение №119 провело через sanitizedHostList два
// перечня из трёх, а обойдён был ровно тот, которым живёт исходящий периметр — и пробельная запись
// `' sms.ru '` была бы МЁРТВОЙ: сопоставитель пробелов не режет). Заморозка при этом не потеряна —
// прибор, а не соглашение: sanitizedHostList возвращает Object.freeze, и в рантайме в перечень
// по-прежнему нельзя ДОПИСАТЬ хост (замерено спецом — дверь начинала его пропускать).
// `as const` на литерале ниже НЕСУЩИЙ для стороннего читателя: check-rf-residency.sh:710 берёт
// перечень из ТЕКСТА до маркера `] as const` — снятие «лишних» слов ослепит сторожа.
export const RF_ALLOWED_PROVIDER_HOSTS = sanitizedHostList([
  'sms.ru',
  'api.unisender.com',
  'geocode-maps.yandex.ru',
  // MAX Bot API — канал сообщений, добавлен по слову владельца 13.08.2026 («сюда нужно ещё и апи
  // макса для сообщений»). Хост РФ-овый, но правило «любой .ru» здесь ОТКЛЮЧЕНО, поэтому без этой
  // строки дверь отказала бы — что и есть смысл перечня.
  //
  // ОТКУДА ВЗЯТ ХОСТ (важно для доверия к строке): из НАШЕГО паспорта продукта
  // `design/product-passports/passport-kwork-6-max-bot.md`, где он записан как база MAX Bot API
  // (токен в заголовке Authorization, long-poll `GET /updates` + `POST /messages`) и где заявлен
  // живой прогон 17.07.2026 (echo-бот ответил владельцу, HTTP 200). Я САМА этот прогон не
  // повторяла и к первоисточнику вендора не обращалась — говорю прямо, чтобы строка не выглядела
  // измеренной мной. НАПРАВЛЕНИЕ ОШИБКИ БЕЗОПАСНОЕ: если хост неверен, дверь ОТКАЖЕТ и канал не
  // заработает — видимый отказ, а не утечка.
  //
  // ⚠️ РАЗРЕШЁННЫЙ ХОСТ ≠ РАБОТАЮЩИЙ КАНАЛ. `max.ru` подписан сертификатом НУЦ Минцифры, которого
  // нет в обычных хранилищах доверия: нашему python-боту понадобился бандл
  // `portfolio/max-bot/russian_trusted_ca.pem`. ⚠️ ЧЕТВЁРТОЕ МЕСТО ОДНОГО ПРЕДПИСАНИЯ, СВЕДЕНО
  // 17.08.2026 (круг 3): здесь стояло «NODE_EXTRA_CA_CERTS или образ с бандлом», тогда как три
  // других места пака это ПРЯМО ЗАПРЕЩАЮТ — переменная процесса расширяет доверие для БД, кэша,
  // хранилища и всех вендоров разом. Верное средство одно: УЗКИЙ бандл на ЭТОТ вызов, и оно
  // сегодня в коде НЕ ПРОВЯЗАНО (замерено грепом: ни dispatcher, ни undici Agent, ни опций ca/tls
  // в backend/src нет) — то есть включение канала упирается в отсутствующий механизм, и это
  // названо находкой, а не решено умолчанием. Иначе TLS упадёт УЖЕ ПОСЛЕ этой проверки, и
  // причина будет выглядеть как «сеть», хотя дело в доверии к сертификату. Это отдельная работа.
  //
  // Адаптер MAX живёт в `lib/providers/messenger/max-bot.adapter.ts` (добавлен тем же паком). Сама
  // ФОРМА вызова тела/ответа — гипотеза из паспорта до первого живого прогона (ADR-0026: утверждение
  // о коде подтверждается прибором, а не текстом). Порт пока никем не инжектится — «шов готов,
  // потребителя нет»; проведение канала до потребителя — отдельная продуктовая работа со своим гейтом.
  'platform-api2.max.ru',
] as const);

/**
 * ХОСТ КАНАЛА MAX ЖИВЁТ В ОДНОМ МЕСТЕ — В ПЕРЕЧНЕ ДВЕРИ ВЫШЕ (находка №125).
 *
 * ЧТО БЫЛО ЗАМЕРЕНО. Факт «наш хост MAX» хранился в ДЕВЯТИ местах: перечень двери, `ENDPOINT`
 * адаптера, текст предупреждения модуля, `.env.example`, ADR-0008 и его русское зеркало и ЧЕТЫРЕ
 * утверждения в ТРЁХ сводах. Две копии были МАШИННО значимы (перечень и ENDPOINT), и правка одной
 * без другой давала не «другой хост», а МЁРТВЫЙ КАНАЛ: дверь отказывает раньше, чем адаптер
 * доходит до сети. А своды при этом закрепляли ровно тот хост, который живьём никем не поднят.
 *
 * ЧТО СДЕЛАНО. Литерал остаётся ровно один — В ПЕРЕЧНЕ (его же читает текстом сторож
 * `check-rf-residency.sh`, поэтому убирать его оттуда НЕЛЬЗЯ), а всё прочее ВЫВОДИТСЯ отсюда:
 * адаптер строит `ENDPOINT`, модуль подставляет хост в предупреждение, своды сверяются с этой
 * константой, а не с собственной копией строки. Правка одной строки перечня меняет все девять.
 *
 * ПОЧЕМУ ПОИСК, А НЕ ИНДЕКС. `RF_ALLOWED_PROVIDER_HOSTS[3]` молча вернул бы СОСЕДА при вставке
 * строки выше — отказ был бы тихим и в самом опасном направлении (канал ушёл бы на чужой хост из
 * нашего же перечня). Поиск по суффиксу `.max.ru` требует РОВНО ОДНОГО совпадения и падает на
 * загрузке модуля при нуле или двух — громко и до первого запроса.
 *
 * ГРАНИЦА ВСЛУХ: это НЕ ответ на вопрос «какой хост верен» (он открыт находкой №56 и ждёт живого
 * вызова). Здесь снята только РАЗМАЗАННОСТЬ ответа по девяти местам.
 */
function ровноОдинХостПоСуффиксу(суффикс: string): string {
  const найденные = RF_ALLOWED_PROVIDER_HOSTS.filter(
    (h) => h === суффикс.replace(/^\./, '') || h.endsWith(суффикс),
  );
  if (найденные.length !== 1) {
    throw new Error(
      `RF_ALLOWED_PROVIDER_HOSTS: по суффиксу «${суффикс}» найдено ${найденные.length} хостов ` +
        `(${найденные.join(', ') || 'ни одного'}), а нужен РОВНО ОДИН — иначе выведенный адрес ` +
        'указывал бы на произвольного соседа по перечню. Поправьте перечень или суффикс.',
    );
  }
  return найденные[0];
}

/** Хост канала MAX. ВЫВЕДЕН из перечня двери — второй копии литерала в дереве быть не должно. */
export const MAX_API_HOST = ровноОдинХостПоСуффиксу('.max.ru');

/**
 * Разрешён ли ИСХОДЯЩИЙ хост провайдера. Строже, чем `isResidentHost`: правило «любой РФ-домен»
 * ОТКЛЮЧЕНО (иначе перечень выше — украшение). Проходят только: точный хост из перечня и его
 * поддомены («свой, а не похожий»: `sms.ru.evil.com` не пройдёт) либо заведомо своё —
 * loopback / RFC1918 / IPv6-ULA / односегментное имя, где ни один байт не покидает машину
 * (это нужно живым стендам и мокам, и без этого замок отнял бы способность тестировать).
 * Новый провайдер добавляется КОД-РЕВЬЮ, а не правкой `.env` — в этом и смысл.
 */
/**
 * Послабление для СТЕНДОВЫХ односегментных имён у исходящей двери (решение держателя 17.08.2026).
 *
 * Значение читается СТРОГО: включает только явное `1` / `true` / `yes` (без регистра и пробелов).
 * Пустая строка, `0`, `false`, опечатка — это СТРОГИЙ режим, а не «включено». Третий полюс оси
 * поставлен по прямому требованию держателя и по свежему уроку находки №60: значение, которое
 * ВЫГЛЯДИТ как выключение, не смеет включать.
 *
 * ═══ ОДИН РАЗБОР ВМЕСТО ТРЁХ (находка №165, круг 5). ═══
 * Правило разбора этого тумблера было записано ТРИЖДЫ, каждый раз своим кодом: схема (`envSchema`)
 * перечисляла допустимый словарь, дверь (`standHostsAllowed`) сравнивала с тремя литералами, а
 * стартовое предупреждение (`providers.module.ts::standHostsWarning`) — со своими тремя. Согласия
 * этих трёх не стерегла НИ ОДНА ось: замер круга 5 дописал в дверь `|| raw === 'on'` и получил
 * 301 зелёный из 301 при РАСШИРЕННОМ периметре и МОЛЧАЩЕМ предупреждении.
 *
 * Лечение — не новая проверка, а снятие копий: словарь объявлен ОДИН раз (`STAND_HOSTS_TOGGLE_ON`
 * и `..._OFF`), из него же собран enum схемы, и он же — единственный разбор `standHostsToggleOn`.
 * ГРАНИЦА НАЗВАНА ВСЛУХ: источником значения у двери ОСТАЁТСЯ `process.env`, а не валидированный
 * конфиг. Дверь зовётся из статической функции ВНЕ DI (`lib/providers/http.util.ts`) и из воркера,
 * то есть в процессах, где `validateEnv` мог не отработать; перевод её на конфиг менял бы не
 * источник, а ПОВЕДЕНИЕ (что дверь пускает и когда), и это решение не моё. Здесь снят только
 * ДУБЛЬ РАЗБОРА — множество принимаемых значений не изменилось ни на один литерал (доказано
 * осью «словарь двери побайтно равен словарю схемы» ниже в спеке).
 */
export const STAND_HOSTS_TOGGLE_ON = Object.freeze(['1', 'true', 'yes'] as const);
export const STAND_HOSTS_TOGGLE_OFF = Object.freeze(['0', 'false', 'no'] as const);
/** Полный словарь тумблера = ВКЛ ∪ ВЫКЛ. Единственный источник для enum схемы. */
export const STAND_HOSTS_TOGGLE_VALUES = Object.freeze([
  ...STAND_HOSTS_TOGGLE_ON,
  ...STAND_HOSTS_TOGGLE_OFF,
] as const);

/**
 * Нормализация значения тумблера — ТА ЖЕ для схемы и для двери (`trim` + нижний регистр).
 * Не-строка проходит НАСКВОЗЬ (схема обязана сама сказать «ожидалась строка», а не получить '').
 */
export function normalizeStandHostsToggle(raw: unknown): unknown {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
}

/**
 * ЕДИНСТВЕННЫЙ разбор тумблера: «включено» ⇔ значение после нормализации лежит в `..._ON`.
 * Всё прочее — включая `undefined`, пустое, опечатку и значение ВНЕ словаря — СТРОГИЙ режим.
 */
export function standHostsToggleOn(raw: unknown): boolean {
  const value = normalizeStandHostsToggle(raw);
  return (
    typeof value === 'string' &&
    (STAND_HOSTS_TOGGLE_ON as readonly string[]).includes(value)
  );
}

export function standHostsAllowed(): boolean {
  return standHostsToggleOn(process.env.ALLOW_LOCAL_STAND_HOSTS);
}

export function isAllowedProviderHost(rawHost: string): boolean {
  return isResidentHost(rawHost, RF_ALLOWED_PROVIDER_HOSTS, {
    allowRfSuffixes: false,
    outbound: true,
  });
}

/**
 * True when `host` can be treated as RF-resident (ADR-0017). Fail-CLOSED: anything not positively
 * recognised is rejected. Accepted shapes:
 *
 *  1. **Self-hosted / non-routable** — loopback, RFC1918 / IPv6-ULA / link-local literals, and
 *     single-label hostnames (`sentry`, `minio` — the compose/k8s service name; a dotless name
 *     cannot be a public FQDN, so it is by construction inside our own network).
 *  2. **An RF domain** — one of RF_ALLOWED_HOST_SUFFIXES.
 *  3. **An explicitly approved exact host** — `allowedExactHosts` (and its subdomains), used for RF
 *     providers that live under a non-RF TLD (RF_ALLOWED_STORAGE_HOSTS).
 *  4. Nothing else. In particular any OTHER IP literal is rejected: a bare public IP is exactly
 *     the form in which residency cannot be checked at all.
 */
export function isResidentHost(
  rawHost: string,
  allowedExactHosts: readonly string[] = [],
  opts: { allowRfSuffixes?: boolean; outbound?: boolean } = {},
): boolean {
  const allowRfSuffixes = opts.allowRfSuffixes !== false;
  // ИСХОДЯЩИЙ периметр строже РЕЗИДЕНТНОСТИ, и вот почему они не могут быть одним правилом.
  // Резидентность отвечает на вопрос «лежат ли данные в РФ» — там IPv6-ULA (`fd00::5`) законно
  // означает «своя машина в своей сети», и БД/кэш по такому адресу мы принимаем (это работающая
  // способность, снимать её нельзя). Исходящий периметр отвечает на другой вопрос — «куда уйдёт
  // байт», и там ровно те же адреса означают метаданные облака: IPv4-IMDS живёт в link-local
  // (169.254.169.254, закрыт ниже для всех), а IPv6-IMDS — В САМОЙ ULA (`fd00:ec2::254` у AWS).
  // Значит для двери ULA и link-local закрываются ЦЕЛИКОМ — «весь диапазон, а не точечно IMDS»,
  // тем же доводом, каким закрыт 169.254/16. Замерено reviewer-qa на ре-гейте 15.08.2026:
  // до этой правки `http://[fe80::1]/x` и `http://[fd00:ec2::254]/latest/meta-data/` ПРОХОДИЛИ
  // дверь (calls=1) — предписание находки №6 требовало закрыть fe80::/10, и было выполнено
  // только для IPv4. Стенды и моки не страдают: наружу они ходят по loopback/RFC1918/
  // односегментному имени (замерено грепом по конфигам — ни одного ULA-адреса в исходящих).
  const outbound = opts.outbound === true;
  const host = rawHost
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '');
  if (host === '') return false;

  // ИМЯ ПЕТЛИ. Для ДВЕРИ — только ТОЧНОЕ `localhost`; для РЕЗИДЕНТНОСТИ `*.localhost` пока
  // ПРИНИМАЕТСЯ, и это РЕШЕНИЕ КРУГА 2, а не свойство мира. Лечение находки №9 закрыло
  // односегментные имена и оставило открытым тот же класс ЭТАЖОМ ВЫШЕ: `evil.localhost` проходил
  // дверь БЕЗ флага стендов, потому что эта строка стоит выше всей outbound-логики. Замерено
  // безопасником тремя приборами (круг 2, 17.08): дверь пускала `evil.localhost` и
  // `sub.evil.localhost` при УДАЛЁННОМ флаге, включая открытый http.
  //
  // 🔴 ОБОСНОВАНИЕ АСИММЕТРИИ ИСПРАВЛЕНО (круг 4): здесь стояло «RFC 6761 обещает петлю» — а ТРЕМЯ
  // СТРОКАМИ НИЖЕ лежал замер, ЭТО ОБЕЩАНИЕ ОПРОВЕРГАЮЩИЙ (в нашем образе node:20-alpine имя
  // разрешил РЕЗОЛВЕР СРЕДЫ и вернул 203.0.113.9). Обоснование, опровергнутое собственным файлом,
  // — не обоснование. Честная формулировка такая: резидентность принимает `*.localhost` НЕ потому,
  // что RFC обещает петлю, а потому, что односегментные имена (`postgres`, `redis`) она принимает
  // по правилу 1 с ТЕМ ЖЕ свойством — разрешение отдано резолверу среды, — и этот риск принят
  // давно и осознанно.
  //
  // РЕШЕНИЕ ДЕРЖАТЕЛЯ 20.08.2026 ПОСЛЕ ЗАМЕРА ЦЕНЫ (его имя, его риск): КЛАСС НЕ ЗАКРЫВАЕТСЯ, риск
  // принимается ЯВНО. Правило, по которому он решал: закрываем класс ЦЕЛИКОМ либо не закрываем
  // ничего и называем риск вслух — «полумера меняет не защиту, а самоощущение». Замер: у
  // `*.localhost` цена снятия НОЛЬ (ни одного вхождения), у РАВНОЗНАЧНОГО случая — односегментных
  // имён — цена НЕ ноль: `postgres`/`redis`/`minio` несут ВСЮ объявленную топологию (.env.example
  // 34/43/55, deploy/gen-env.sh 140/240/355/357, живой .env стенда). Значит закрыть целиком сегодня
  // нельзя, а закрыть половину хуже, чем ничего. Риск снимет переход резидентных адресов на
  // литералы/FQDN. Ось-запись: «РИСК ПРИНЯТ ЯВНО: резидентность принимает *.localhost И
  // односегментные имена — свойство у них одно» (env.validation.spec).
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return !outbound;

  // IPv6 literal (checked BEFORE the suffix rules: `fd…`/`fc…` prefixes must never be tested
  // against a DNS name like `fdservice.com`).
  if (host.includes(':')) {
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    // Для ДВЕРИ (outbound) ULA и link-local закрыты целиком — см. довод выше у `outbound`.
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return !outbound; // fc00::/7 unique-local
    if (/^fe80:/.test(host)) return !outbound; // link-local
    return false; // any other IPv6 literal — location unverifiable
  }

  // IPv4 literal: only the private / loopback ranges count as self-hosted.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 169.254.0.0/16 (link-local) НЕ считается «своим» для ИСХОДЯЩЕГО периметра: единственный живой
    // адрес там — `169.254.169.254`, метаданные облака (Yandex/AWS/GCP выдают по нему IAM-токены
    // инстанса), и любой будущий SSRF, попавший на него, стал бы кражей облачных ключей. Ни один наш
    // стенд link-local наружу не зовёт (compose/k8s — это RFC1918 и односегментные имена), поэтому
    // закрыт весь диапазон, а не точечно IMDS. Найдено спецом-безопасником при гейте 14.08.2026.
    return false;
  }

  // ОДНОСЕГМЕНТНОЕ ИМЯ: для РЕЗИДЕНТНОСТИ — своё (контейнер/LAN: `postgres`, `redis`, `minio`),
  // для ИСХОДЯЩЕЙ ДВЕРИ — строго по умолчанию. Разрешение такого имени отдано `resolv.conf`
  // МАШИНЫ, а не нашему перечню: при заданном search-домене `http://evilhost/x` уходит НАРУЖУ, и
  // докстринг «ни один байт не покидает машину» на этом ломается (находка №9 ре-гейта, вес важно
  // поставлен держателем 15.08).
  //
  // ФОРМА ПОСЛАБЛЕНИЯ — РЕШЕНИЕ ДЕРЖАТЕЛЯ 17.08, И ОНА ПЕРЕВЁРНУТА ОТНОСИТЕЛЬНО ОЧЕВИДНОЙ.
  // Очевидная («строго только при NODE_ENV=production») отвергнута им как FAIL-OPEN ПО УМОЛЧАНИЮ:
  // переменная не выставлена — периметр открыт; опечатка «Production»/«prod» — открыт; боевой
  // процесс без неё — открыт. То есть строгость держалась бы на том, что кто-то ПОМНИЛ выставить
  // переменную, и была бы слабее всего там, где дороже всего. Вдобавок NODE_ENV трогает половина
  // инструментов сборки — вешать на общую переменную замок периметра нельзя.
  // Поэтому: СТРОГО ВСЕГДА, послабление — только при ЯВНОМ отдельном флаге. Стенды способность не
  // теряют (закон храповика), но включают её ОСОЗНАННО, а не попутно.
  // ОДНИ ЦИФРЫ — ЭТО НЕ ИМЯ КОНТЕЙНЕРА, А IPv4 В ДЕСЯТИЧНОЙ ФОРМЕ (находка круга 1 №51). Замерено:
  // `postgresql://…@134744072:5432/zoolink` объявлялось резидентным, тогда как рантайм соединяется
  // с 8.8.8.8 — «своё» тут выводится из ФОРМЫ имени, а форма обманчива. Ни один наш стенд числовых
  // имён не использует (postgres, redis, minio), поэтому способность не отнята ни у кого.
  if (/^[0-9]+$/.test(host)) return false;
  if (!host.includes('.')) return outbound ? standHostsAllowed() : true;

  // Explicitly approved RF provider host (or one of its subdomains — the virtual-host bucket form).
  // `.` is prepended so `storage.yandexcloud.net.evil.com` cannot pass as a subdomain.
  if (
    allowedExactHosts.some(
      (h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`),
    )
  ) {
    return true;
  }

  // Правило «любой РФ-домен» ВЫКЛЮЧАЕМО: для ИСХОДЯЩИХ адресов провайдеров оно сделало бы
  // перечень разрешённых хостов декоративным (два из трёх наших и так под .ru), и новый адаптер
  // с любым .ru-хостом прошёл бы БЕЗ код-ревью. Резидентности он не нарушает — но класс
  // «новый адаптер тихо добавил хост» закрывается только явным перечнем.
  if (!allowRfSuffixes) return false;
  return RF_ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

/**
 * ADR-0017 п.6 — a telemetry/error ingest host. No provider carve-out: an error sink is either
 * self-hosted or under an RF domain (`storage.yandexcloud.net` is an object store, not a sink).
 */
export function isResidentTelemetryHost(rawHost: string): boolean {
  return isResidentHost(rawHost);
}

/**
 * ADR-0017 п.1 — a PRIMARY DATA STORE host (PostgreSQL, Redis). No provider carve-out, for the same
 * reason the telemetry rule has none: `storage.yandexcloud.net` is an object-storage endpoint and
 * admitting it here would widen clause 1 by accident. Today's documented prod topology self-hosts both
 * (`postgres:5432`, `redis:6379` — compose service names, rule 1 of `isResidentHost`), so a
 * suffix-plus-self-hosted rule removes nothing. The day a MANAGED RF database is adopted (Yandex
 * Managed PostgreSQL lives at `*.mdb.yandexcloud.net`, which no RF-suffix rule can see) its host joins
 * an explicit constant here — a code change through the ADR/security gate, never an `.env` edit.
 */
export function isResidentDataStoreHost(rawHost: string): boolean {
  return isResidentHost(rawHost);
}

/**
 * ADR-0017 п.1 — accepted URI schemes for the two primary-store DSNs. Pinned, and pinned as CODE the
 * CI gate parses (same single-source-of-truth discipline as RF_ALLOWED_HOST_SUFFIXES), because the
 * pre-existing shape checks were `startsWith('postgres')` / `startsWith('redis')` — a PREFIX test on
 * the whole string, which admits `postgres-anything://…` and therefore admits a value whose host slot
 * this validator would be reading under the wrong grammar. `postgresql`/`postgres` are the two forms
 * Prisma accepts; `redis`/`rediss` the two ioredis accepts (`rediss` = TLS). Anything else is
 * fail-closed: a DSN we cannot read under a known grammar is a DSN whose host we cannot clear.
 */
export const RF_DATABASE_URL_SCHEMES = Object.freeze(['postgresql', 'postgres'] as const);
export const RF_REDIS_URL_SCHEMES = Object.freeze(['redis', 'rediss'] as const);

/**
 * Verdict of a DSN residency check. `targets` lists EVERY connection target the DSN names (a DSN can
 * name several — see `dsnTargets`), a unix socket rendered as `unix:<path>`. `offending` is the first
 * target that could not be shown resident. Neither field ever carries the DSN itself: a DSN is a
 * credential.
 */
export interface DsnResidencyVerdict {
  ok: boolean;
  targets: string[];
  offending: string | null;
  /**
   * ПРИЧИНА НАЗЫВАЕТСЯ ТОЧНО (находка №136, круг 5). До лечения ПЯТЬ разных бед сливались в один
   * вердикт `unparseable`, и текст отказа обвинял ХОСТ — замерено: `mysql://zoolink:pw@postgres:5432/db`
   * печатало «DATABASE_URL names no readable database host», хотя хост `postgres` стоит в строке и
   * ВЕРЕН, а виновата СХЕМА. Читающий первое предложение (а в три ночи читают первое) шёл пинговать
   * исправный хост и лезть в compose. Различитель существовал ВНУТРИ разбора и просто не выводился
   * наружу; теперь он выведен, и каждая беда называется своим именем:
   *  · `empty`           — значение пустое (для обеих переменных законного «пусто» нет);
   *  · `bad-scheme`      — схема есть, но не наша (`mysql://`); `scheme` несёт её имя;
   *  · `no-scheme`       — префикса `схема://` нет вовсе (`postgres:5432/db`);
   *  · `no-host`         — грамматика прочитана, но цели не названо ни одной (`postgresql://`);
   *  · `unreadable-host` — цель названа, но прочесть её нельзя (битый percent-escape) — ЕДИНСТВЕННЫЙ
   *                        случай, в котором прежний текст про «нечитаемый хост» был правдой;
   *  · `non-rf-host`     — прочли всё, хост НЕ резидентен (единственная причина, которую dev-байпас
   *                        вправе смягчить; остальные fail-closed ВЕЗДЕ).
   */
  reason:
    | 'resident'
    | 'empty'
    | 'bad-scheme'
    | 'no-scheme'
    | 'no-host'
    | 'unreadable-host'
    | 'non-rf-host';
  /**
   * Имя непринятой схемы при `bad-scheme`, иначе null. НЕ СЕКРЕТ ПО ПОСТРОЕНИЮ: значение берётся
   * из группы `^([A-Za-z][A-Za-z0-9+.-]*)://`, то есть физически не может унести ни пароль, ни
   * хост, ни путь — только слово до `://`. Остальные поля вердикта DSN не несут никогда: DSN —
   * это учётные данные.
   */
  scheme: string | null;
}

/**
 * Reads ONE `host[:port]` piece of a DSN authority (or of a `host=` query parameter) down to the thing
 * a client would actually connect to. Returns null when the piece cannot be read at all — the caller
 * turns that into a fail-closed `unparseable` verdict.
 *
 * The percent-decode happens FIRST and is not cosmetic: libpq's own unix-socket form puts the socket
 * DIRECTORY in the host slot percent-encoded (`postgresql://%2Fvar%2Frun%2Fpostgresql/zoolink`). Left
 * encoded it is a dotless string, which rule 1 of `isResidentHost` would wave through as a "service
 * name" — right answer, wrong reason, and the wrong reason breaks the moment the path contains a dot
 * (`%2Fvar%2Frun%2Fpg.sock` would then be judged as a DNS name and REJECTED). Recognising the socket
 * explicitly is what keeps that capability.
 *
 * Everything else is resolved by a REAL URL parse through a synthetic `http://` prefix, so IPv6
 * brackets, ports, uppercase and percent-escapes are normalised by the same host parser the runtime
 * uses — not by a regex of ours.
 */
function dsnHostTarget(piece: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(piece);
  } catch {
    return null; // malformed percent-escape — unreadable, so unclearable
  }
  if (decoded.startsWith('/')) return `unix:${decoded}`;
  let host: string;
  try {
    host = new URL(`http://${piece}`).hostname;
  } catch {
    return null;
  }
  return host === '' ? null : host;
}

/**
 * Extracts EVERY connection target a DSN names, or null when the value cannot be read under an
 * approved grammar (fail-closed). Deliberately hand-parsed rather than handed to `new URL()` whole,
 * because the two real-world forms below are exactly the ones a single `new URL().hostname` gets
 * wrong — measured 2026-08-09 on Node 20:
 *
 *  * **libpq multi-host** (`postgres://u:p@host1,host2/db`) — `new URL()` does NOT throw and reports
 *    `hostname === "host1,host2"`, ONE string. Fed to the suffix rules that string is dotless, so
 *    `postgres://u:p@localhost,evil-abroad/db` would have passed as a "service name" while the client
 *    fails over to the second host. So the authority is split on `,` and each piece checked
 *    independently: ALL of them must be resident, because ANY of them may be the one that serves.
 *    (The with-ports variant `host1:5432,host2:5432` is rejected one step earlier by
 *    `z.string().url()` — measured: `new URL()` throws ERR_INVALID_URL — so it is not a shape this
 *    validator can be reached with.)
 *  * **host as a query parameter** (`postgresql:///db?host=/var/run/postgresql`) — the authority is
 *    EMPTY and the real target lives in the query, invisible to `.hostname`. The parameter is checked
 *    IN ADDITION to any authority host rather than instead of it: which one libpq prefers when both
 *    are present is a detail we refuse to depend on, and requiring both to be resident is the answer
 *    that is safe under either reading.
 *
 * Userinfo is dropped at the LAST `@` — the delimiter WHATWG and libpq both use — so a host-shaped
 * credential (`postgres://zoolink.ru@ep-abroad.example/db`) can never be mistaken for the host.
 */
type DsnParse =
  | { ok: true; targets: string[] }
  | {
      ok: false;
      reason: 'empty' | 'bad-scheme' | 'no-scheme' | 'no-host' | 'unreadable-host';
      scheme: string | null;
    };

function dsnTargets(
  rawValue: string,
  allowedSchemes: readonly string[],
): DsnParse {
  const value = rawValue.trim();
  // ПОРЯДОК РАЗБОРА = ПОРЯДОК ДИАГНОЗА, и он не случаен: пустое проверяется ПЕРВЫМ (иначе пустая
  // строка получила бы диагноз «нет схемы» — формально верный и бесполезный), затем наличие
  // схемы, затем её допустимость, и только потом хосты. Каждая ступень называет СВОЮ беду.
  if (value === '') return { ok: false, reason: 'empty', scheme: null };
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
  if (!schemeMatch) return { ok: false, reason: 'no-scheme', scheme: null };
  const scheme = schemeMatch[1].toLowerCase();
  if (!allowedSchemes.includes(scheme)) {
    return { ok: false, reason: 'bad-scheme', scheme };
  }

  const rest = value.slice(schemeMatch[0].length);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);

  const qStart = rest.indexOf('?');
  const hashStart = rest.indexOf('#');
  const query =
    qStart !== -1 && (hashStart === -1 || qStart < hashStart)
      ? rest.slice(qStart + 1, hashStart === -1 ? undefined : hashStart)
      : '';

  const targets: string[] = [];

  const at = authority.lastIndexOf('@');
  const hostList = at === -1 ? authority : authority.slice(at + 1);
  for (const piece of hostList.split(',')) {
    const trimmed = piece.trim();
    if (trimmed === '') continue;
    const target = dsnHostTarget(trimmed);
    if (target === null) {
      return { ok: false, reason: 'unreadable-host', scheme };
    }
    targets.push(target);
  }

  for (const [key, raw] of new URLSearchParams(query)) {
    if (key.toLowerCase() !== 'host') continue;
    for (const piece of raw.split(',')) {
      const trimmed = piece.trim();
      if (trimmed === '') continue;
      // URLSearchParams has already percent-decoded, so an absolute path arrives as one.
      const target = trimmed.startsWith('/')
        ? `unix:${trimmed}`
        : dsnHostTarget(trimmed);
      if (target === null) {
        return { ok: false, reason: 'unreadable-host', scheme };
      }
      targets.push(target);
    }
  }

  // No target at all (`postgres://`, `redis://`) — fail-closed: a store whose location the config does
  // not state is a store whose location cannot be cleared.
  return targets.length > 0
    ? { ok: true, targets }
    : { ok: false, reason: 'no-host', scheme };
}

/**
 * ADR-0017 п.1 gate shared by `DATABASE_URL` and `REDIS_URL`. A unix-socket target is resident by
 * construction (a socket file is on THIS machine); every hostname target goes through the same
 * `isResidentHost` core as clauses 4 and 6, so there is one rule to keep true, not four.
 *
 * There is no lawful "empty" mode for either variable — both are boot-required (no `.default()`), the
 * app cannot run without them — so, unlike `SENTRY_DSN`/`MEDIA_CDN_HOST`, there is no `disabled`
 * verdict: empty is `unparseable`.
 */
export function checkDsnResidency(
  rawValue: string,
  allowedSchemes: readonly string[],
): DsnResidencyVerdict {
  const parse = dsnTargets(rawValue, allowedSchemes);
  if (!parse.ok) {
    return {
      ok: false,
      targets: [],
      offending: null,
      reason: parse.reason,
      scheme: parse.scheme,
    };
  }
  const { targets } = parse;
  const offending = targets.find(
    (t) => !(t.startsWith('unix:') || isResidentDataStoreHost(t)),
  );
  if (offending !== undefined) {
    return { ok: false, targets, offending, reason: 'non-rf-host', scheme: null };
  }
  return { ok: true, targets, offending: null, reason: 'resident', scheme: null };
}

/** ADR-0017 п.1 — the PRIMARY store of personal data. */
export function checkDatabaseUrl(rawValue: string): DsnResidencyVerdict {
  return checkDsnResidency(rawValue, RF_DATABASE_URL_SCHEMES);
}

/** ADR-0017 п.1 — the cache / throttler store sitting in front of it. */
export function checkRedisUrl(rawValue: string): DsnResidencyVerdict {
  return checkDsnResidency(rawValue, RF_REDIS_URL_SCHEMES);
}

/**
 * ADR-0017 п.4 — an object-storage / media-CDN host. Same rules as the telemetry sink PLUS the
 * approved RF provider hosts (RF_ALLOWED_STORAGE_HOSTS), because the ADR-0008 prod bucket lives at
 * `storage.yandexcloud.net`, which no RF-suffix rule can recognise.
 */
export function isResidentStorageHost(rawHost: string): boolean {
  return isResidentHost(rawHost, RF_ALLOWED_STORAGE_HOSTS);
}

/**
 * Verdict of a host-residency check (DSN, storage endpoint, CDN host). `host` is null when nothing
 * parseable could be extracted. `disabled` means the value was empty AND empty is a lawful "off"
 * mode for that variable.
 */
export interface HostResidencyVerdict {
  ok: boolean;
  /** The host, for the error message. NEVER the raw value (a DSN carries a credential). */
  host: string | null;
  reason: 'disabled' | 'resident' | 'unparseable' | 'non-rf-host';
}

/** Historical name kept for the DSN call sites (same shape — one type, so it cannot diverge). */
export type TelemetryDsnVerdict = HostResidencyVerdict;

/**
 * ADR-0017 п.6 gate for a Sentry-style DSN (`https://<publicKey>@<host>[:port]/<projectId>`).
 *
 * Empty = the sink is DISABLED, which is lawful and is today's live configuration — that mode must
 * keep working untouched (no-capability-regression). Non-empty is checked with a REAL URL parse, not
 * a substring test: the DSN carries userinfo, so `https://key.ru@o0.ingest.sentry.io/1` would sail
 * through any `includes('.ru')` check while shipping abroad. Unparseable is rejected too — a DSN
 * whose host cannot be determined cannot be shown to be resident (fail-closed).
 */
export function checkTelemetryDsn(dsn: string): TelemetryDsnVerdict {
  const value = dsn.trim();
  if (value === '') return { ok: true, host: null, reason: 'disabled' };
  let host: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, host: null, reason: 'unparseable' };
    }
    host = url.hostname;
  } catch {
    return { ok: false, host: null, reason: 'unparseable' };
  }
  if (host === '') return { ok: false, host: null, reason: 'unparseable' };
  return isResidentTelemetryHost(host)
    ? { ok: true, host, reason: 'resident' }
    : { ok: false, host, reason: 'non-rf-host' };
}

/**
 * Human-readable rendering of the RF suffix allowlist for an error message. Punycode duplicates are
 * dropped: `.рф` and `.xn--p1ai` are the same TLD, and printing both only confuses the operator.
 */
function allowedSuffixesForMessage(): string {
  return RF_ALLOWED_HOST_SUFFIXES
    .filter((s) => !s.startsWith('.xn--'))
    .join(', ');
}

/** Boot/init error text for a rejected DSN. Prints the HOST only, never the DSN (credential). */
export function telemetryDsnRejectionMessage(
  verdict: TelemetryDsnVerdict,
): string {
  const allowed = allowedSuffixesForMessage();
  if (verdict.reason === 'unparseable') {
    return `SENTRY_DSN is set but no http(s) ingest host could be parsed from it — refusing (fail-closed): an unverifiable error sink cannot be shown to be RF-resident (ADR-0017 п.6 / ФЗ-152 ст.18 ч.5). Leave SENTRY_DSN empty to disable error reporting.`;
  }
  return `error-sink host "${verdict.host ?? '(unknown)'}" is NOT RF-resident (ADR-0017 п.6 / ФЗ-152 ст.18 ч.5) — stack traces and error context carry PII, so the ingest must be self-hosted (loopback / private address / single-label service name) or under an RF domain (${allowed}). An empty SENTRY_DSN disables error reporting and is permitted. A non-RF sink is permitted only outside production with RESIDENCY_ALLOW_NON_RF_DEV=true.`;
}

/**
 * ADR-0017 п.4 gate for `S3_ENDPOINT` — the object store that holds PII (provider documents,
 * avatars, listing photos; PII inventory in data-governance.md §1, encrypted per ADR-0012).
 *
 * WHY this is the same defect class as the DSN and NOT a new one: the residency guardrail as
 * specified in the ADR scans REGION-bearing values, and a bucket is named by a HOST. `S3_REGION` can
 * sit at an approved `ru-central1` while `S3_ENDPOINT` points at `s3.us-west-004.backblazeb2.com` —
 * measured 2026-08-09: all three residency layers reported green with exactly that config.
 *
 * Form: a full URL, because that is what the value already is (`http://minio:9000`), and the host is
 * taken by a REAL URL parse rather than a substring test — `https://ru.example.com@evil.com/` would
 * satisfy any `includes('.ru')` check while resolving to `evil.com`. The scheme is additionally
 * pinned to http(s): `z.string().url()` accepts ANY scheme (measured: `ftp://…` passed), and a
 * non-http endpoint is both unusable by the S3 client and unverifiable here.
 *
 * There is NO lawful "empty" mode — S3_ENDPOINT is boot-required (no `.default()`), the app cannot
 * store media without it — so unlike the DSN there is no `disabled` verdict. Empty/unparseable is
 * fail-closed in every environment: a host we cannot read is a host we cannot clear.
 *
 * Enforced HERE only (plus the CI gate), unlike the DSN which also needs a check inside `initSentry`:
 * nothing reads `S3_ENDPOINT` before Nest boots (`providers.module.ts` takes it off the validated
 * config surface), so no byte can leave for the bucket before this refine has run.
 */
export function checkStorageEndpoint(rawValue: string): HostResidencyVerdict {
  const value = rawValue.trim();
  if (value === '') return { ok: false, host: null, reason: 'unparseable' };
  let host: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, host: null, reason: 'unparseable' };
    }
    host = url.hostname;
  } catch {
    return { ok: false, host: null, reason: 'unparseable' };
  }
  if (host === '') return { ok: false, host: null, reason: 'unparseable' };
  return isResidentStorageHost(host)
    ? { ok: true, host, reason: 'resident' }
    : { ok: false, host, reason: 'non-rf-host' };
}

/** Boot error text for a rejected `S3_ENDPOINT`. Names the HOST, never credentials. */
export function storageEndpointRejectionMessage(
  verdict: HostResidencyVerdict,
): string {
  const allowed = allowedSuffixesForMessage();
  const providers = RF_ALLOWED_STORAGE_HOSTS.join(', ');
  if (verdict.reason === 'unparseable') {
    return `S3_ENDPOINT is not a parseable http(s) endpoint — refusing (fail-closed): an object store whose host cannot be read cannot be shown to be RF-resident (ADR-0017 п.4 / ФЗ-152 ст.18 ч.5). Use the form http(s)://host[:port], e.g. http://minio:9000.`;
  }
  return `object-storage host "${verdict.host ?? '(unknown)'}" is NOT RF-resident (ADR-0017 п.4 / ФЗ-152 ст.18 ч.5) — the bucket holds personal data (provider documents, avatars, listing photos), so the endpoint must be self-hosted (loopback / private address / single-label service name such as minio:9000), under an RF domain (${allowed}), or an approved RF provider host (${providers}). A non-RF endpoint is permitted only outside production with RESIDENCY_ALLOW_NON_RF_DEV=true.`;
}

/**
 * ADR-0017 п.4 gate for `MEDIA_CDN_HOST` — strictly MORE dangerous than the bucket itself, because
 * this value is not merely *where we upload*: `mediaAllowedHosts()` ADDS it to the media-URL
 * allowlist (lib/media/media-url.ts), so whatever host is named here becomes a host from which
 * durable media — including user avatars, personal data under ADR-0012 — is legitimately cached and
 * served. `MEDIA_CDN_HOST=cdn.cloudflare.com` therefore both exports PII to a foreign edge network
 * AND widens the own-storage check that exists to stop moderation-swap and latent SSRF.
 *
 * Form differs from the DSN/endpoint: this is a BARE `host[:port]` with no scheme, so `new URL(value)`
 * cannot be used directly. The value is first restricted to host characters — anything containing
 * `/`, `@`, `%`, `?`, `#` or whitespace is refused outright — and only then parsed via a synthetic
 * `http://` prefix. That order is what makes the parse trustworthy: `https://cdn.zoolink.ru`,
 * `evil.com/cdn.zoolink.ru` and `key@evil.com` can never reach the suffix test wearing a host's
 * clothes, and a value the operator *thinks* is a host but is not is a boot error rather than a
 * silently-unmatchable allowlist entry.
 *
 * EMPTY = no CDN, which is lawful, is the documented MVP default and is today's live value in
 * `.env.example` — that mode must keep working untouched (no-capability-regression).
 */
export function checkMediaCdnHost(rawValue: string): HostResidencyVerdict {
  const value = rawValue.trim();
  if (value === '') return { ok: true, host: null, reason: 'disabled' };
  // Host characters only (letters, digits, dot, dash, underscore, colon for the port, brackets for
  // an IPv6 literal). Everything else — scheme separators, userinfo, path, query, percent-escapes,
  // whitespace — is refused before any parse is attempted.
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(value)) {
    return { ok: false, host: null, reason: 'unparseable' };
  }
  let host: string;
  try {
    host = new URL(`http://${value}`).hostname;
  } catch {
    return { ok: false, host: null, reason: 'unparseable' };
  }
  if (host === '') return { ok: false, host: null, reason: 'unparseable' };
  return isResidentStorageHost(host)
    ? { ok: true, host, reason: 'resident' }
    : { ok: false, host, reason: 'non-rf-host' };
}

/** Boot error text for a rejected `MEDIA_CDN_HOST`. */
export function mediaCdnHostRejectionMessage(
  verdict: HostResidencyVerdict,
): string {
  const allowed = allowedSuffixesForMessage();
  const providers = RF_ALLOWED_STORAGE_HOSTS.join(', ');
  if (verdict.reason === 'unparseable') {
    return `MEDIA_CDN_HOST must be a bare host[:port] — no scheme, no path, no credentials (e.g. cdn.zoolink.ru) — refusing (fail-closed): a CDN host that cannot be read cannot be shown to be RF-resident (ADR-0017 п.4 / ФЗ-152 ст.18 ч.5). Leave it empty to serve media straight from the S3 origin.`;
  }
  return `media CDN host "${verdict.host ?? '(unknown)'}" is NOT RF-resident (ADR-0017 п.4 / ФЗ-152 ст.18 ч.5) — this host is ADDED to the media-URL allowlist, so it would cache and serve avatars and listing photos (personal data, ADR-0012) from outside the RF. It must be self-hosted (loopback / private address / single-label service name), under an RF domain (${allowed}), or an approved RF provider host (${providers}). An empty MEDIA_CDN_HOST (no CDN — the default) is permitted. A non-RF CDN is permitted only outside production with RESIDENCY_ALLOW_NON_RF_DEV=true.`;
}

/**
 * ПЕРВОЕ ПРЕДЛОЖЕНИЕ ОТКАЗА — САМ ДИАГНОЗ (находка №136, круг 5). Возвращает текст беды ФОРМЫ для
 * `DATABASE_URL`/`REDIS_URL`, либо null, если форма прочиталась и беда в РЕЗИДЕНТНОСТИ хоста
 * (её текст строит вызывающий, называя хост).
 *
 * ЗАЧЕМ ОТДЕЛЬНОЙ ФУНКЦИЕЙ, А НЕ ДВУМЯ ВЕТКАМИ НА МЕСТЕ: обе переменные ломаются ОДИНАКОВО, и
 * прежняя формулировка была скопирована в оба места слово в слово — а копия расходится молча.
 * Соседи по файлу давно называют ФОРМУ честно (`S3_ENDPOINT is not a parseable http(s) endpoint`,
 * `MEDIA_CDN_HOST must be a bare host[:port]`); эти двое единственные обвиняли выдуманное.
 *
 * ЧТО НЕ ПОПАДАЕТ В ТЕКСТ: ни само значение, ни его хвост, ни хост — только ИМЯ ПЕРЕМЕННОЙ и, при
 * `bad-scheme`, слово до `://`, которое по построению регулярного выражения не может быть секретом.
 */
function dsnShapeFault(
  verdict: DsnResidencyVerdict,
  variable: 'DATABASE_URL' | 'REDIS_URL',
  schemes: string,
): string | null {
  switch (verdict.reason) {
    case 'empty':
      return `${variable} is empty, and there is no lawful "no store" mode for it`;
    case 'no-scheme':
      return `${variable} has no ${schemes} scheme — the value must start with one (a bare host:port is not a DSN)`;
    case 'bad-scheme':
      return `${variable} uses the unsupported scheme "${verdict.scheme ?? '(unknown)'}://" — only ${schemes} are read under a known grammar, so the host slot of anything else cannot be trusted`;
    case 'no-host':
      return `${variable} names no host at all — the scheme is right but the value states no connection target`;
    case 'unreadable-host':
      return `${variable} names a host that cannot be read (malformed escape or authority)`;
    default:
      return null;
  }
}

/**
 * Boot error text for a rejected `DATABASE_URL` (ADR-0017 п.1). Names the offending HOST and nothing
 * else — a DSN carries the database password.
 */
export function databaseUrlRejectionMessage(
  verdict: DsnResidencyVerdict,
): string {
  const allowed = allowedSuffixesForMessage();
  const schemes = (RF_DATABASE_URL_SCHEMES as readonly string[])
    .map((s) => `${s}://`)
    .join(' or ');
  const shape = dsnShapeFault(verdict, 'DATABASE_URL', schemes);
  if (shape !== null) {
    return `${shape} — refusing (fail-closed): the PRIMARY store of personal data cannot be shown to be RF-resident if its location cannot be read (ADR-0017 п.1 / ФЗ-152 ст.18 ч.5). Use ${schemes}user:password@host[:port]/db, e.g. postgresql://zoolink:***@postgres:5432/zoolink?schema=public (a unix socket via ?host=/var/run/postgresql is also accepted).`;
  }
  return `database host "${verdict.offending ?? '(unknown)'}" is NOT RF-resident (ADR-0017 п.1 / ФЗ-152 ст.18 ч.5) — DATABASE_URL is the PRIMARY store of personal data (accounts, phone_hash, encrypted email/contact_phone per ADR-0012, listings, consents, the moderation audit trail), so ФЗ-152 ст.18 ч.5 requires it to sit on RF territory. It must be self-hosted (loopback / private address / single-label service name such as postgres:5432 / a unix socket) or under an RF domain (${allowed}). A non-RF database is permitted only outside production with RESIDENCY_ALLOW_NON_RF_DEV=true.`;
}

/**
 * Boot error text for a rejected `REDIS_URL` (ADR-0017 п.1). Same discipline: the offending HOST only.
 */
export function redisUrlRejectionMessage(verdict: DsnResidencyVerdict): string {
  const allowed = allowedSuffixesForMessage();
  const schemes = (RF_REDIS_URL_SCHEMES as readonly string[])
    .map((s) => `${s}://`)
    .join(' or ');
  const shape = dsnShapeFault(verdict, 'REDIS_URL', schemes);
  if (shape !== null) {
    return `${shape} — refusing (fail-closed): a cache that also holds personal data cannot be shown to be RF-resident if its location cannot be read (ADR-0017 п.1 / ФЗ-152 ст.18 ч.5). Use ${schemes}[:password@]host[:port], e.g. redis://:***@redis:6379.`;
  }
  return `Redis host "${verdict.offending ?? '(unknown)'}" is NOT RF-resident (ADR-0017 п.1 / ФЗ-152 ст.18 ч.5) — Redis is not "just a cache": it stores the rate-limit and throttler counters keyed by phone/IP, the listing-creation quota keyed by user id, and cached profile/listing payloads, i.e. personal data derived from the primary store. It must be self-hosted (loopback / private address / single-label service name such as redis:6379) or under an RF domain (${allowed}). A non-RF Redis is permitted only outside production with RESIDENCY_ALLOW_NON_RF_DEV=true.`;
}

/**
 * Canonical environment contract. Mirrors ../.env.example (ADR-0008 provider choices).
 * Fail-fast: the process must not boot with a missing/invalid required variable.
 */
export const envSchema = z.object({
  // Fail-SAFE default (OWASP fail-safe defaults): a boot that FORGETS to set NODE_ENV lands in the
  // most-restrictive mode ('production'), never the permissive one. This is the security-critical
  // fix for the dev-token fail-OPEN chain (AUDIT3 security.md #1): the old `.default('development')`
  // meant a prod deploy that omitted NODE_ENV booted with isProduction===false and left the
  // master-key /auth/dev-token route LIVE. dev/test set NODE_ENV explicitly (.env / jest), so only a
  // genuinely-unconfigured boot inherits the locked-down default.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  // Dev-token master-key route (auth.controller devToken) is gated by this flag, INDEPENDENT of
  // NODE_ENV, and defaults to false (fail-closed). Strict parse: only the literal 'true'/'false'
  // are accepted — a typo ('1','TRUE','yes') is a boot-blocking error, never silently truthy (a
  // z.coerce.boolean() would treat 'false' as true — the exact footgun we avoid). The endpoint is
  // reachable ONLY when ENABLE_DEV_TOKEN===true AND NODE_ENV!=='production' (see AppConfigService).
  ENABLE_DEV_TOKEN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ПОСЛАБЛЕНИЕ ПЕРИМЕТРА НА ТИПИЗИРОВАННОЙ ПОВЕРХНОСТИ КОНФИГУРАЦИИ (находка круга 2 безопасника).
  // Раньше флаг читался ПРЯМО из process.env и в схеме не значился вовсе: он не проверялся при
  // старте, его состояние нигде не печаталось, а `gen-env.sh` и `validateEnv` не видели его совсем —
  // строгость периметра в бою держалась на том, что никто не вписал строку. Форма — та же, что у
  // соседа выше: строгий enum, где ОПЕЧАТКА РОНЯЕТ ЗАГРУЗКУ, а не молча означает «выключено».
  // Дверь по-прежнему читает `process.env` напрямую (она вызывается вне DI, из статической функции),
  // поэтому схема здесь — ВТОРОЙ рубеж и объявление намерения, а не единственный источник истины;
  // сказано прямо, чтобы никто не счёл объявление достаточным.
  // ДВА ЧИТАТЕЛЯ ОДНОЙ ПЕРЕМЕННОЙ НЕ СМЕЮТ РАСХОДИТЬСЯ В РЕГИСТРЕ (находка круга 4). Дверь приводит
  // значение к нижнему регистру, а схема принимала только строчные — `TRUE` роняло старт с
  // сообщением про недопустимое значение, тогда как дверь его поняла бы. Расхождение fail-closed и
  // громкое, но всё же расхождение: приводим здесь тем же способом, что и дверь.
  // ОДИН РАЗБОР НА ТРЁХ ЧИТАТЕЛЕЙ (находка №165, круг 5): и словарь, и нормализация взяты из
  // `STAND_HOSTS_TOGGLE_VALUES` / `normalizeStandHostsToggle` — тех же, которыми живёт дверь.
  // Литеральный перечень здесь БОЛЬШЕ НЕ ПИШЕТСЯ: пока он стоял копией, дверь могла принять
  // значение, которого схема не знает (замерено мутантом `'on'`: 301 зелёный при расширенном
  // периметре). Порядок значений в тексте ошибки zod теперь «ВКЛ, затем ВЫКЛ» — множество то же.
  ALLOW_LOCAL_STAND_HOSTS: z
    .preprocess(
      normalizeStandHostsToggle,
      z.enum(STAND_HOSTS_TOGGLE_VALUES),
    )
    .default('false'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_DOMAIN: z.string().min(1).default('localhost'),

  // CORS allowlist for cross-origin browsers — comma-separated EXACT origins (e.g.
  // "http://localhost:5173"). EMPTY (the default) = CORS disabled: the production topology is
  // same-origin behind Caddy (ADR-0009), where no CORS header is needed. Set it ONLY for cross-origin
  // LOCAL development (a SPA dev-server on another port). main.ts enables CORS with credentials:true
  // when this is non-empty — never a wildcard, because the refresh cookie requires an exact origin.
  // This lists the ALLOWED front-end origins only; the public base path itself lives in config/api-base.
  CORS_ORIGINS: z.string().optional().default(''),

  // ADR-0017 dev-only escape hatch. Permits a NON-RF `*_REGION` value (e.g. a local MinIO left at
  // its native `us-east-1` default) ONLY when NODE_ENV!=='production'. Strict-parsed / fail-closed
  // (same discipline as ENABLE_DEV_TOKEN). In production this flag is IGNORED — the RF allowlist is
  // unconditional there, because residency is a hard legal precondition (ФЗ-152 ст.18 ч.5). The CI
  // residency gate additionally blocks any non-RF region in prod config regardless of this flag.
  RESIDENCY_ALLOW_NON_RF_DEV: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // PostgreSQL — single source of connectivity is DATABASE_URL. Shape here; the ADR-0017 п.1
  // RESIDENCY of the database HOST is enforced by the .superRefine below (checkDatabaseUrl). This is
  // the HEAVIEST member of the "the host leaves the country through env" class: measured 2026-08-09,
  // `DATABASE_URL=postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db` booted cleanly at
  // NODE_ENV=production with every other residency layer green — the PRIMARY store of РФ-citizen
  // personal data, abroad, on one edited line. `.startsWith('postgres')` is kept as the fast early
  // shape error, but it is a PREFIX test on the whole string and is NOT the scheme pin: that lives in
  // RF_DATABASE_URL_SCHEMES, checked by the refine.
  DATABASE_URL: z.string().url().startsWith('postgres'),

  // Redis — required for throttler storage + caching. Same clause-1 refine as DATABASE_URL
  // (checkRedisUrl): measured red-before `rediss://d:p@eu2-x.upstash.io:6379` was accepted in
  // production. Redis holds rate-limit/quota counters keyed by phone/IP/user id and cached
  // profile/listing payloads, so it is PII-bearing in practice, not a location-neutral cache.
  REDIS_URL: z.string().url().startsWith('redis'),

  // Object storage (S3-compatible). Shape here; the ADR-0017 п.4 RESIDENCY of the endpoint HOST is
  // enforced by the .superRefine below (checkStorageEndpoint) — the bucket holds PII, and a region
  // string cannot see a foreign host: S3_REGION=ru-central1 with
  // S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com passed every layer until 2026-08-09.
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // Region string. Shape-validated here; the RF-residency allowlist (ADR-0017) is enforced by the
  // .superRefine below (which also covers any future `*_REGION` var). Default is an approved RF id,
  // so a dev on our .env.example is compliant without extra config; MinIO's native `us-east-1`
  // default is rejected in prod (must be pinned to an approved RF id) — the intended trap.
  S3_REGION: z.string().min(1).default('ru-central1'),

  // Optional prod CDN host placed in FRONT of the S3/MinIO origin (e.g. a Yandex CDN / caching layer
  // over the bucket). When set, its host is ADDED to the media-URL allowlist (lib/media/media-url.ts)
  // alongside the S3_ENDPOINT host, so listing photos served from the CDN pass the own-storage check
  // (AUDIT3 media host allowlist, Wave B2). HOST only (no scheme/path), e.g. `cdn.zoolink.ru`. Empty =
  // no CDN (S3 host is the sole allowed origin — the MVP default). The allowlist BUILD lives in
  // lib/media so the rule stays testable in isolation; the ADR-0017 п.4 RESIDENCY of this host is
  // enforced by the .superRefine below (checkMediaCdnHost). Residency matters MORE here than for the
  // bucket: because the host is added to the media allowlist, a foreign CDN would legitimately cache
  // and serve avatars (PII, ADR-0012) abroad — and widen the own-storage check at the same time.
  MEDIA_CDN_HOST: z.string().optional().default(''),

  // Auth / JWT — secrets must be long enough to be meaningful.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_REFRESH_TTL: z.string().min(1).default('7d'),

  // Identity: server pepper for the deterministic phone_hash = HMAC-SHA256(phone, pepper)
  // (spec 01 round-4). Must be long/secret; rotating it invalidates phone-based lookups.
  PHONE_HASH_PEPPER: z.string().min(32),

  // PII-at-rest crypto seam (ADR-0019, enforcing ADR-0012). Two independent secrets, no default
  // (boot-blocking, same discipline as JWT/pepper) — the KMS/СКЗИ swap-point is inside CryptoService.
  //  - PII_DATA_KEY: source of the AES-256-GCM data key (field-encrypt email/contact_phone). Rotating
  //    it requires a re-encrypt migration of the affected columns.
  //  - PII_BLIND_INDEX_KEY: HMAC key for the deterministic email blind index (email_bidx). Rotating it
  //    requires a blind-index backfill (recovery/admin-search lookups would otherwise stop matching).
  PII_DATA_KEY: z.string().min(32),
  PII_BLIND_INDEX_KEY: z.string().min(32),

  // Agent service-auth signing secret (ADR-0011 §5.2). FORM ONLY in MVP: declared and length-validated
  // (≥32) at boot, but the AGENT gate is off so no agent service token is ever issued/verified. Optional
  // in dev/test; the prod-required check is enforced by the .superRefine below (same discipline as JWT
  // secrets). Empty string is treated as "not set" so dev/test boot without it.
  AGENT_SERVICE_SIGNING_SECRET: z
    .string()
    .min(32)
    .optional()
    .or(z.literal('')),

  // Retention job (D2, ADMIN_PHASE_ACTION_PLAN.md). Worker-only periodic pass:
  //  - RETENTION_TICK_CRON: cron expression for the tick (default hourly). Read at decorator-eval
  //    time by RetentionExpireJob (@nestjs/schedule decorators cannot read DI), so it is a
  //    deployment-time constant; still declared here so its shape is documented and validated.
  //  - RETENTION_GRACE_DAYS: deactivation grace before erase_user runs (spec 01 / data-governance.md;
  //    30-day grace is the documented default).
  RETENTION_TICK_CRON: z.string().min(1).default('0 * * * *'),
  RETENTION_GRACE_DAYS: z.coerce.number().int().positive().default(30),

  // Listing-creation quota (AUDIT4 P1-4): max NEW listings a single user may create per rolling 24h,
  // Redis-backed per-user counter. Caps supply-flood / Sybil poisoning of per-city liquidity + the
  // moderation-queue DoS the create path otherwise has no defence against (only Idempotency-Key). The
  // default (20/day) is a generous ceiling for a legitimate seller; tune per market/abuse-signal later.
  LISTING_CREATION_QUOTA_PER_DAY: z.coerce.number().int().positive().default(20),

  // Providers (ADR-0008). Empty credential → that adapter runs in stub mode.
  SMS_PROVIDER: z.string().default('smsru'),
  SMSRU_API_ID: z.string().optional().default(''),
  SMS_FROM: z.string().optional().default(''), // approved SMS.RU sender name (optional)
  EMAIL_PROVIDER: z.string().default('unisender'),
  UNISENDER_API_KEY: z.string().optional().default(''),
  UNISENDER_LIST_ID: z.string().optional().default(''), // Unisender list for unsubscribe footer
  EMAIL_FROM: z.string().optional().default(''), // verified sender address
  EMAIL_FROM_NAME: z.string().optional().default('ZooLink'),
  // Канал сообщений (MAX Bot API, ADR-0008; по слову владельца 13.08.2026). Как у соседей по шву:
  // без токена фабрика берёт заглушку, поэтому переменная необязательна и канал по умолчанию спит.
  MESSENGER_PROVIDER: z.string().default('max'),
  // 🔴 ТОКЕН НЕ СМЕЕТ НЕСТИ УПРАВЛЯЮЩИЕ ЗНАКИ — иначе он УТЕЧЁТ В ЖУРНАЛ ЦЕЛИКОМ (крит №164-бис,
  // круг 5). Замер: `Bearer <токен со ВСТРОЕННЫМ \r\n>` заставляет undici бросить
  // `Headers.append: "Bearer mQ7bV2xLpR9k\n_BOEVOY_TOKEN…" is an invalid header value.` —
  // сообщение НЕСЁТ ВЕСЬ СЕКРЕТ, а http.util кладёт его в текст ProviderError и дальше в журнал
  // сервера. Запись необратима, атакующий не нужен: хватает секрета, склеенного из двух строк,
  // или переноса при вставке в .env.
  // ЛЕЧИМ ИСТОЧНИК, А НЕ СООБЩЕНИЕ: замазывать секрет в свободном тексте регэкспом структурно
  // неполно и рождает ложную уверенность — у нас это уже замерено. Плохое значение просто не
  // доживает до заголовка.
  // ГРАНИЦА, НАЗВАННАЯ ЗАМЕРОМ: ОДИНОЧНЫЙ хвостовой \r или \n undici обрезает молча, и утечки
  // там нет — то есть самый частый случай («секрет из файла с концевым переводом строки») был
  // безопасен и остаётся рабочим: .trim() снимает его ДО проверки, способность не отнята.
  // СООБЩЕНИЕ НАЗЫВАЕТ ПЕРЕМЕННУЮ И НИКОГДА — ЗНАЧЕНИЕ (правило разглашения, оно же :79-80
  // http.util.ts, где тот же довод уже применён к URL).
  MAX_BOT_TOKEN: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.trim())
    // Проверяем КОДОМ ЗНАКА, а не регэкспом с управляющими символами: правило no-control-regex
    // запрещает вписывать их в шаблон, и оно право — такой шаблон нечитаем и легко ошибиться на
    // границе диапазона. Условие ниже говорит то же самое словами: всё ниже пробела плюс DEL.
    .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f), {
      message:
        'MAX_BOT_TOKEN содержит управляющий знак (перенос строки, табуляцию или иной символ < 0x20). ' +
        'Значение НЕ печатается намеренно: сообщение об этой ошибке попадает в журнал, а секрет в журнал не пишется. ' +
        'Скорее всего секрет склеен из двух строк или перенесён при вставке — задайте его ОДНОЙ строкой.',
    }),
  YANDEX_MAPS_API_KEY: z.string().optional().default(''),

  // OAuth providers (ADR-0008). Empty → that provider is stub-in-dev / rejected-in-prod.
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional().default(''),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  OAUTH_APPLE_CLIENT_ID: z.string().optional().default(''),
  // Sign in with Apple uses a client-secret JWT signed with an ES256 .p8 key, so it needs three
  // additional values beyond the client id (D3 / OPS-11 — env FORM only; the adapter is deferred).
  // Form chosen: the .p8 contents go in OAUTH_APPLE_PRIVATE_KEY (mounted as a secret file and read
  // into the env), matching how every other secret is handled here (no file paths in env, no key
  // material in the repo). Optional in dev/test; for a real prod Apple integration all three are
  // required together — enforced by the .superRefine below.
  OAUTH_APPLE_TEAM_ID: z.string().optional().default(''),
  OAUTH_APPLE_KEY_ID: z.string().optional().default(''),
  OAUTH_APPLE_PRIVATE_KEY: z.string().optional().default(''),
  OAUTH_TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  OAUTH_VK_CLIENT_ID: z.string().optional().default(''),
  OAUTH_VK_CLIENT_SECRET: z.string().optional().default(''),

  // Payments — Фаза 2+, gated by feature_toggles.payments (ADR-0008). Interface defined now; stub in MVP.
  PAYMENT_PROVIDER: z.string().default('yookassa'),
  YOOKASSA_SHOP_ID: z.string().optional().default(''),
  YOOKASSA_SECRET_KEY: z.string().optional().default(''),

  // Observability.
  // /metrics scrape credential (ops secret). MetricsGuard reads it per-request straight from
  // process.env (defence-in-depth gate), so it is NOT consumed off the typed config surface — but its
  // PRESENCE is boot-validated here: OPTIONAL in dev/test (MetricsGuard's internal-client fallback
  // covers local/in-cluster scraping), REQUIRED (≥16 chars) in production — enforced in the
  // validateEnv block below, same discipline as AGENT_SERVICE_SIGNING_SECRET. WHY prod-required:
  // without a token, prod MetricsGuard falls back to trusting the source IP (req.ip); behind the Caddy
  // reverse proxy every request's remote address looks internal/loopback, so /metrics (business volumes
  // + route/label cardinality) would be effectively world-readable. Requiring the token in prod closes
  // the D8-gate 🟡 (AUDIT3 security.md). If set anywhere, must be ≥16 (a too-short token is a boot error).
  METRICS_TOKEN: z.string().min(16).optional().or(z.literal('')),
  // Error-sink DSN. EMPTY (the default, and today's live value) = Sentry disabled — a lawful mode
  // that stays lawful. When set, the ingest HOST is residency-checked by the .superRefine below
  // (ADR-0017 п.6): a stack trace is PII-bearing observability data, so a foreign ingest
  // (`*.ingest.sentry.io`) would export РФ-citizen PII across the border under ФЗ-152 ст.18 ч.5.
  // Enforced in TWO places on purpose: here (boot-blocking) AND inside initSentry, because main.ts
  // initialises Sentry from raw process.env BEFORE Nest — and therefore before this validator — so a
  // boot-time-only check would still let the very "invalid env" report be shipped abroad.
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
})
  // ADR-0017 layer 1 (runtime, fail-at-boot). Scan EVERY `*_REGION` var generically (S3_REGION
  // today; managed-PG / replica / backup / DR / log-sink region vars in future) and reject any
  // value outside RF_ALLOWED_REGIONS. Aggregates into the same boot-blocking error report as the
  // rest of the schema. The dev bypass applies ONLY outside production (residency is unconditional
  // in prod). Non-string values (there are none today) are skipped defensively.
  //
  // The same block also enforces the HOST-bearing clauses of the ADR, which no `*_REGION` scan can
  // see: clause 6 (SENTRY_DSN — where errors are shipped) and clause 4 (S3_ENDPOINT + MEDIA_CDN_HOST —
  // where media/PII is stored and from where it is served). One boot-blocking report covers all of
  // "where data is stored", "from where it is served" and "where errors are shipped".
  .superRefine((val, ctx) => {
    const devBypass =
      val.NODE_ENV !== 'production' && val.RESIDENCY_ALLOW_NON_RF_DEV === true;
    for (const [key, raw] of Object.entries(val)) {
      if (!key.endsWith('_REGION') || typeof raw !== 'string') continue;
      if (isRfRegion(raw) || devBypass) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `"${raw}" is not an approved RF region (ADR-0017 / ФЗ-152 ст.18 ч.5). Allowed: ${RF_ALLOWED_REGIONS.join(
          ', ',
        )}. A non-RF region is permitted only in dev with RESIDENCY_ALLOW_NON_RF_DEV=true.`,
      });
    }

    // ADR-0017 clause 6 — the PII-bearing observability sink. A region string is not the only way
    // data leaves the country: SENTRY_DSN names a HOST, and stack traces carry PII. Empty = sink
    // disabled (allowed). Same dev-bypass discipline as the region rule; in production the bypass is
    // IGNORED, because residency there is unconditional. An unparseable DSN is rejected in EVERY
    // environment (a host we cannot read is a host we cannot clear).
    const dsnVerdict = checkTelemetryDsn(val.SENTRY_DSN);
    if (
      !dsnVerdict.ok &&
      !(dsnVerdict.reason === 'non-rf-host' && devBypass)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENTRY_DSN'],
        message: telemetryDsnRejectionMessage(dsnVerdict),
      });
    }

    // ADR-0017 clause 4 — the PII-bearing OBJECT STORE and the CDN in front of it. Same defect class
    // as the DSN above, in two more places: the region axes are blind to a HOST, so a foreign bucket
    // (`s3.us-west-004.backblazeb2.com`) or a foreign CDN (`cdn.cloudflare.com`) sailed through every
    // layer while S3_REGION sat innocently at `ru-central1`. Same dev-bypass discipline throughout:
    // it relaxes only a `non-rf-host` verdict, only outside production, and NEVER an unparseable one.
    const s3Verdict = checkStorageEndpoint(val.S3_ENDPOINT);
    if (!s3Verdict.ok && !(s3Verdict.reason === 'non-rf-host' && devBypass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_ENDPOINT'],
        message: storageEndpointRejectionMessage(s3Verdict),
      });
    }

    const cdnVerdict = checkMediaCdnHost(val.MEDIA_CDN_HOST);
    if (!cdnVerdict.ok && !(cdnVerdict.reason === 'non-rf-host' && devBypass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEDIA_CDN_HOST'],
        message: mediaCdnHostRejectionMessage(cdnVerdict),
      });
    }

    // ADR-0017 clause 1 — the PRIMARY store of personal data (`DATABASE_URL`) and the cache/throttler
    // store in front of it (`REDIS_URL`). Last and HEAVIEST member of the same class as clauses 4 and 6:
    // a region axis cannot see a host, and neither DSN carries a region string at all, so
    // `S3_REGION=ru-central1` sat green while the database itself could be a US-East Neon endpoint
    // (measured 2026-08-09: accepted at NODE_ENV=production, CI gate silent).
    //
    // Same core (`isResidentHost`), same dev-bypass discipline as every clause above — it relaxes only a
    // `non-rf-host` verdict, only outside production, and NEVER an unparseable one. In production the
    // rule is unconditional, because residency of the primary store is not a preference but the
    // condition under which processing РФ-citizens' data is lawful at all (ФЗ-152 ст.18 ч.5).
    const dbVerdict = checkDatabaseUrl(val.DATABASE_URL);
    if (!dbVerdict.ok && !(dbVerdict.reason === 'non-rf-host' && devBypass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: databaseUrlRejectionMessage(dbVerdict),
      });
    }

    const redisVerdict = checkRedisUrl(val.REDIS_URL);
    if (!redisVerdict.ok && !(redisVerdict.reason === 'non-rf-host' && devBypass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: redisUrlRejectionMessage(redisVerdict),
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Used by @nestjs/config `validate`. Throws (boot-blocking) with a readable report.
 *
 * ═══ ОТЧЁТ ОБ ОТКАЗЕ СТАРТА ОБЯЗАН БЫТЬ ПОЛНЫМ ИЛИ ЧЕСТНО СКАЗАТЬ, ЧТО ОН НЕ ПОЛОН ═══
 * (находка №138, круг 5.)
 *
 * ЗАМЕР ДО ЛЕЧЕНИЯ (jiti, боевой конфиг, три прод-требования не выставлены):
 *   A → «Invalid environment configuration:\n  - AGENT_SERVICE_SIGNING_SECRET: …»   (выставили)
 *   B → «Invalid environment configuration:\n  - METRICS_TOKEN: …»                  (выставили)
 *   C → «Invalid environment configuration:\n  - OAUTH_APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY: …»
 * Три беды — ТРИ ПЕРЕЗАПУСКА, тогда как ветка zod те же три печатает РАЗОМ. Заголовок у всех
 * четырёх отчётов побуквенно один, поэтому отличить «полный список» от «первого из очереди»
 * по тексту было НЕЛЬЗЯ. Оператор, однажды увидевший отчёт из трёх строк, справедливо считает
 * отчёт полным — чинит одну переменную, ждёт подъёма контейнера и миграций и получает следующую
 * беду того же класса, которую можно было назвать сразу. В самый дорогой момент — первый боевой
 * старт или подъём после аварии — это три круга ожидания вместо одного.
 *
 * ЛЕЧЕНИЕ ДВУСЛОЙНОЕ, потому что и беда двуслойная:
 *  (1) вторая половина проверок (та, что читает УЖЕ разобранный конфиг) больше не бросает по
 *      одной: все её беды копятся в `issues` и печатаются ОДНИМ отчётом. Три перезапуска → один.
 *  (2) первая половина (zod) технически не может слиться со второй: вторая читает `parsed.data`,
 *      которого при провале zod не существует. Раз слить нельзя — надо СКАЗАТЬ. Заголовок ветки
 *      zod теперь прямо объявляет себя НЕПОЛНЫМ («stage 1 of 2 … not yet run»), а заголовок
 *      второй ветки — полным. Форма отчёта больше не обещает полноты, которой у неё нет.
 *
 * ГРАНИЦА: обе шапки начинаются с прежней строки `Invalid environment configuration` — по ней
 * ищут и CI (.github/workflows/ci.yml:527,532), и оси этого файла. Расширение идёт ХВОСТОМ.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // ЧЕСТНАЯ ШАПКА НЕПОЛНОГО ОТЧЁТА: производственные проверки ниже читают разобранный конфиг,
    // которого здесь ещё нет, поэтому они НЕ ПРОГНАНЫ — и отчёт обязан это сказать, а не молчать.
    throw new Error(
      `Invalid environment configuration (stage 1 of 2 — shape & residency; the production-readiness checks have NOT run yet, so this list may not be the last):\n${issues}`,
    );
  }

  // ВТОРАЯ ПОЛОВИНА — ОДНИМ ОТЧЁТОМ. Каждая проверка ДОПИСЫВАЕТ свою беду и идёт дальше; бросок
  // один и в конце. Порядок строк сохранён прежний (агент-секрет → METRICS_TOKEN → Apple), чтобы
  // диффом было видно: изменилась ПОЛНОТА отчёта, а не его содержание.
  const issues: string[] = [];

  // ADR-0011 §5.2: the agent service-signing secret is optional in dev/test (form-only, gate off) but
  // MUST be present (≥32) in production so the form is boot-ready the moment the AGENT gate is enabled.
  if (
    parsed.data.NODE_ENV === 'production' &&
    !parsed.data.AGENT_SERVICE_SIGNING_SECRET
  ) {
    issues.push(
      '  - AGENT_SERVICE_SIGNING_SECRET: required in production (min 32 chars)',
    );
  }
  // /metrics gate hardening (AUDIT3 security.md, D8 🟡): in production METRICS_TOKEN MUST be set (≥16,
  // shape-checked above). Without it MetricsGuard falls back to trusting req.ip — and behind the reverse
  // proxy every client looks internal — so the scrape endpoint would be world-readable. Optional in
  // dev/test (the internal-client fallback is fine there). Empty string is treated as "not set".
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.METRICS_TOKEN) {
    issues.push(
      '  - METRICS_TOKEN: required in production (min 16 chars) — else MetricsGuard trusts req.ip behind the proxy and /metrics is world-readable',
    );
  }
  // ЗАПОЛНЕННАЯ ЗАГЛУШКА ХУЖЕ ПУСТОГО ЗНАЧЕНИЯ — И ЭТО ЗАМЕР, А НЕ ОСТОРОЖНОСТЬ (находка №174,
  // решение держателя 31.08.2026; док-первым: docs/06-operations/deployment-mvp.md + зеркало).
  //
  // ЧТО СЛУЧИЛОСЬ. Проверка выше меряет ФОРМУ: «задан и ≥16 знаков». 29.08.2026 шаблон научили
  // стартовать дословно, и `.env.example` получил `METRICS_TOKEN=__change_me_32_hex_or_longer__` —
  // 30 знаков. Форма сошлась, боевой старт перестал падать, а два негатив-контроля в
  // `gen-env.spec.ts` покраснели и пролежали красными двое суток (CI на паке не запускался).
  //
  // ПОЧЕМУ ЭТО НЕ «ПРОСТО СЛАБЫЙ СЕКРЕТ», А ОСЛАБЛЕНИЕ ЗАМКА. `MetricsGuard` (lib/metrics/
  // metrics.guard.ts) ветвится по вопросу «ЗАДАН ЛИ токен»: НЕ задан → режим «только изнутри»
  // (loopback / RFC1918, всему прочему 404); ЗАДАН → пускает любого, кто его предъявил. Значение
  // этой заглушки опубликовано в нашем же репозитории. То есть заполнение сделало замок СЛАБЕЕ
  // СОБСТВЕННОГО ОТСУТСТВИЯ — и молча, потому что старт прошёл.
  //
  // ПОЧЕМУ ОТКАЗ ПО ИМЕНИ, А НЕ ПО ДЛИНЕ ИЛИ ЭНТРОПИИ: длину заглушка уже прошла, а энтропию
  // считать значило бы гадать. `change_me` — наша собственная конвенция шаблона, то есть признак
  // НАМЕРЕНИЯ «здесь ещё не подставлено», и он не может совпасть со честно отчеканенным секретом.
  // ОХВАТ НАЗВАН ВСЛУХ: правило покрывает ТОЛЬКО METRICS_TOKEN (решение держателя). Распространить
  // его на все секреты — отдельное решение; молча расширить значило бы сделать утверждение шире
  // замера, чем этот пак болеет.
  if (
    parsed.data.NODE_ENV === 'production' &&
    typeof parsed.data.METRICS_TOKEN === 'string' &&
    parsed.data.METRICS_TOKEN.toLowerCase().includes('change_me')
  ) {
    issues.push(
      '  - METRICS_TOKEN: это ЗАГЛУШКА ШАБЛОНА (значение содержит «change_me»), а не секрет. ' +
        'Значение не печатается намеренно. Заполненная заглушка ОПАСНЕЕ пустого значения: при ' +
        'ЗАДАННОМ токене MetricsGuard пускает любого, кто его предъявил, а это значение опубликовано ' +
        'в репозитории — тогда как при ПУСТОМ он пускает только loopback/приватные диапазоны. ' +
        'Похоже, что сделан `cp .env.example .env`: провизионируйте через `deploy/gen-env.sh` ' +
        '(см. docs/06-operations/deployment-mvp.md).',
    );
  }
  // D3 / OPS-11: Sign in with Apple is all-or-nothing. The adapter is deferred (stub-on-empty), but if
  // any Apple credential is supplied in production, the full set must be present so the form is never
  // half-configured. All-empty = Apple OAuth simply off (stub-in-dev / 503-in-prod, like other providers).
  if (parsed.data.NODE_ENV === 'production') {
    const apple = {
      OAUTH_APPLE_CLIENT_ID: parsed.data.OAUTH_APPLE_CLIENT_ID,
      OAUTH_APPLE_TEAM_ID: parsed.data.OAUTH_APPLE_TEAM_ID,
      OAUTH_APPLE_KEY_ID: parsed.data.OAUTH_APPLE_KEY_ID,
      OAUTH_APPLE_PRIVATE_KEY: parsed.data.OAUTH_APPLE_PRIVATE_KEY,
    };
    const set = Object.entries(apple).filter(([, v]) => v !== '');
    if (set.length > 0 && set.length < Object.keys(apple).length) {
      for (const [k] of Object.entries(apple).filter(([, v]) => v === '')) {
        issues.push(
          `  - ${k}: required when any OAUTH_APPLE_* is set in production`,
        );
      }
    }
  }

  if (issues.length > 0) {
    // ШАПКА ПОЛНОГО ОТЧЁТА: сюда попадают ТОЛЬКО после успешного zod-разбора, значит прогнаны обе
    // половины и список действительно последний. Второго перезапуска за следующей бедой не будет.
    throw new Error(
      `Invalid environment configuration (stage 2 of 2 — production readiness; complete list):\n${issues.join('\n')}`,
    );
  }
  return parsed.data;
}
