#!/usr/bin/env bash
# ADR-0017 (RF data residency; ФЗ-152 ст.18 ч.5) — layer 2 of the 3-layer guardrail.
#
# Fails (non-zero) if any region-bearing value in the PROD deploy config resolves to a region
# outside the approved RF allowlist. Region-bearing = every `*_REGION` assignment (object store,
# and — as they are added — managed-PG / replica / backup / DR-failover / PII-bearing log-sink
# region vars), plus any foreign cloud-region token embedded in an endpoint/host.
#
# It ALSO fails on any non-RF HOST-bearing value, which no region axis can see:
#   * clause 6 — the error/telemetry ingest (`SENTRY_DSN`);
#   * clause 4 — the PII-bearing object store (`S3_ENDPOINT`) and the CDN in front of it
#     (`MEDIA_CDN_HOST`, whose host is ADDED to the media-URL allowlist, so it serves avatars);
#   * clause 1 — the PRIMARY store of personal data (`DATABASE_URL`) and the cache/throttler store in
#     front of it (`REDIS_URL`). Heaviest member of the class: measured 2026-08-09, with a
#     region-token-free foreign endpoint (`postgresql://…@ep-x.aws.neon.tech/db` +
#     `rediss://…@eu2-x.upstash.io:6379`) THIS GATE EXITED 0 and the boot validator accepted the
#     config at NODE_ENV=production — the whole database of РФ-citizens' personal data abroad, silently.
# NONE of them carries a region string at all: measured 2026-08-09, `S3_REGION=ru-central1` +
# `S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com` + `MEDIA_CDN_HOST=cdn.cloudflare.com` made this
# gate exit 0 — the exact "three green layers, data still leaves" hole these axes close. The defect is
# ONE class ("the gate checks REGIONS, the data leaves by HOST"), so any NEW host-bearing env var
# (OAuth endpoint, webhook/callback URL, provider base URL) belongs in axis (4) or (5) on the day it is
# added.
#
# SINGLE SOURCE OF TRUTH: every allowlist is extracted from backend/src/config/env.validation.ts
# (RF_ALLOWED_REGIONS, RF_ALLOWED_HOST_SUFFIXES, RF_ALLOWED_STORAGE_HOSTS, RF_DATABASE_URL_SCHEMES,
# RF_REDIS_URL_SCHEMES) so the runtime refine (layer 1) and this CI gate (layer 2) can never diverge —
# and `--selftest` proves a rename of ANY of them reads as rc=2 INCONCLUSIVE, never as a verdict.
# Runnable locally exactly as CI runs it:
# `bash scripts/check-rf-residency.sh`.
#
# Layers: runbook pin (doc) -> THIS CI gate (pre-deploy) -> boot refine (runtime). Defense in depth.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

env_validation="backend/src/config/env.validation.ts"
[ -f "$env_validation" ] || { echo "::error::$env_validation not found — cannot derive the RF allowlist"; exit 2; }

# --selftest — THE AXIS ON THE INSTRUMENT ITSELF (added 09.08.2026 after a measured defect).
# This gate derives its allowlists by parsing constant names out of env.validation.ts, so a rename
# breaks the coupling. The guards below are written to answer that with rc=2 (INCONCLUSIVE) — but
# they were UNREACHABLE for three releases: `set -euo pipefail` killed the assignment first and the
# gate exited 1, i.e. "residency violation found", with no output at all. A wrong verdict, not a
# broken tool. Fixed by `|| true`; this mode is what keeps it fixed. Run it in CI beside the gate.
# НЕИЗВЕСТНЫЙ АРГУМЕНТ = ОТКАЗ, А НЕ ОБЫЧНЫЙ ПРОГОН (находка №116, замер 20.08.2026). До этой
# строки `bash scripts/check-rf-residency.sh --самопроверка` молча прогонял ОБЫЧНЫЙ гейт и печатал
# «✅ gate passed» — вызывающий получал зелёное НЕ ЗА ТО, ЧТО ПРОСИЛ, и принимал утверждение о МИРЕ
# («периметр резидентен») за утверждение о ПРИБОРЕ («самопроверка прошла»). Тот же замок стоит в
# scripts/rollback-outbound-perimeter.sh с круга 4; здесь он не был смётен — лечение по одному
# месту из двух. rc=2 = НЕ ЗНАЮ (ADR-0027), а не 1 («нарушение найдено»).
# РАЗБОР ЧУЖОГО ЯЗЫКА — ОДНОЙ ФУНКЦИЕЙ, ЧТОБЫ ЕГО БЫЛО ЧЕМ ПРОВЕРИТЬ (находка №44: крит-класс
# «комментарий прочитан как ОБЪЯВЛЕНИЕ» воспроизводился на константе, добавленной этим же паком).
# Прежде цепочка sed жила ВНУТРИ оси 6a, и самопроверка могла бы проверить только ЕЁ КОПИЮ — а копия
# источника зеленеет вместе с источником (закон общего эталона, замерен флотом 14.08). Теперь и ось,
# и самопроверка зовут ОДНУ функцию: сломается разбор — покраснеет самопроверка.
strip_comments_and_quote_hosts() {
  sed -E 's@^[[:space:]]*//.*@@; s@//.*@@' | grep -oE "'[A-Za-z0-9.-]+'" | tr -d "'" | sort -u || true
}

# РАЗБОР КАЖДОЙ КОНСТАНТЫ — ИМЕНОВАННОЙ ФУНКЦИЕЙ (встречная сверка, решение держателя 24.08,
# m-20260824-180434-480c). Этот сторож — ЕДИНСТВЕННЫЙ читатель перечней МИМО двери рождения: он
# восстанавливает их из ТЕКСТА исходника. Сегодня он не дыряв только потому, что его шаблоны требуют
# минимум один знак — СОВПАДЕНИЕ, А НЕ ЗАМОК. Поэтому появился режим `--confront`: сверка того, что
# разобрано из текста, с ФАКТИЧЕСКИМ flag_lineм констант в рантайме (гоняется в job со сборкой, где
# зависимости уже стоят). Функции ниже зовут И обычный гейт, И сверка — разбор ОДИН: сверка через
# копию разбора проверяла бы копию, а копия зеленеет вместе с источником (закон общего эталона).
parse_RF_ALLOWED_REGIONS() {
  sed -n '/RF_ALLOWED_REGIONS = \(Object.freeze(\|sanitizedHostList(\)\?\[/,/\]/p' "$env_validation" \
    | grep -oE "'[a-z0-9-]+'" | tr -d "'" | sort -u || true
}
parse_RF_ALLOWED_HOST_SUFFIXES() {
  sed -n '/RF_ALLOWED_HOST_SUFFIXES = \(Object.freeze(\|sanitizedHostList(\)\?\[/,/\]/p' "$env_validation" \
    | grep -oE "'\.[^']+'" | tr -d "'" | sort -u || true
}
# Однострочное объявление — берём ИМЕННО его строку, не sed-диапазон (регрессия оси 4: диапазон
# добегал до `]` следующего блока и allowlist хранилищ тихо рос с 1 хоста до 5).
parse_RF_ALLOWED_STORAGE_HOSTS() {
  grep -E 'export const RF_ALLOWED_STORAGE_HOSTS =' "$env_validation" \
    | grep -oE "'[A-Za-z0-9.-]+'" | tr -d "'" | sort -u || true
}
parse_RF_ALLOWED_PROVIDER_HOSTS() {
  sed -n '/RF_ALLOWED_PROVIDER_HOSTS =/,/\] as const/p' "$env_validation" | strip_comments_and_quote_hosts
}
# СЛОВАРЬ ТУМБЛЕРА СТЕНДОВ БЕРЁТСЯ ИЗ ИСТОЧНИКА, А НЕ СПИСЫВАЕТСЯ (находка №176; лечение №165
# объявило словарь ОДИН раз — четвёртая копия здесь воспроизвела бы ровно ту болезнь, ради которой
# копии и снимали: замер круга 5 показал, что расширение словаря в одном месте давало 301 зелёный
# при РАСШИРЕННОМ периметре).
# ФОРМА РАЗБОРА — ОДНОСТРОЧНАЯ, КАК У СОСЕДЕЙ, И ЭТО НЕ СТИЛЬ. Первая редакция брала диапазон
# `sed -n '/…ON = /,/\]/p'` и захватывала СЛЕДУЮЩУЮ строку тоже: диапазон sed ищет конец начиная
# со строки ПОСЛЕ начальной, поэтому объявление, где начало и конец на одной строке, съедает
# соседа — словарь ВКЛ вернул «1 true yes 0 false no», то есть ВЫКЛЮЧЕНИЕ попало во ВКЛЮЧЕНИЕ, и
# ось стала бы обвинять явное `0`. Поймано прогоном разбора, не чтением. Наш класс «область замера
# захватила чужое», четвёртый flag_form за сутки на трёх аренах.
parse_STAND_HOSTS_TOGGLE_ON() {
  grep -oE "STAND_HOSTS_TOGGLE_ON = (Object\.freeze\()?\[[^]]*\]" "$env_validation" \
    | grep -oE "'[^']+'" | tr -d "'" || true
}
parse_STAND_HOSTS_TOGGLE_OFF() {
  grep -oE "STAND_HOSTS_TOGGLE_OFF = (Object\.freeze\()?\[[^]]*\]" "$env_validation" \
    | grep -oE "'[^']+'" | tr -d "'" || true
}
parse_RF_DATABASE_URL_SCHEMES() {
  grep -oE "RF_DATABASE_URL_SCHEMES = (Object\.freeze\()?\[[^]]*\]" "$env_validation" \
    | grep -oE "'[a-z0-9+.-]+'" | tr -d "'" | sort -u || true
}
parse_RF_REDIS_URL_SCHEMES() {
  grep -oE "RF_REDIS_URL_SCHEMES = (Object\.freeze\()?\[[^]]*\]" "$env_validation" \
    | grep -oE "'[a-z0-9+.-]+'" | tr -d "'" | sort -u || true
}
CONFRONT_CONSTS='RF_ALLOWED_REGIONS RF_ALLOWED_HOST_SUFFIXES RF_ALLOWED_STORAGE_HOSTS RF_ALLOWED_PROVIDER_HOSTS RF_DATABASE_URL_SCHEMES RF_REDIS_URL_SCHEMES'

case "${1:-}" in
  ''|--selftest|--confront) : ;;
  *)
    echo "::error::неизвестный аргумент «$1». Допустимо: без аргументов (гейт), --selftest (ось на сам прибор) или --confront (сверка текст↔рантайм)." >&2
    exit 2
    ;;
esac

# --confront — ВСТРЕЧНАЯ СВЕРКА: то, что разобрано из ТЕКСТА, против ФАКТИЧЕСКОГО значения констант.
# Три состояния (ADR-0027): 0 = сошлось · 1 = РАЗОШЛОСЬ (текст и рантайм говорят разное — гейт
# резидентности судит НЕ ту реальность, что работает) · 2 = НЕ ЗНАЮ (не смог посмотреть: нет node
# или ts-node — это отказ смотреть, а не «чисто»). Гоняется там, где стоят зависимости (CI job
# build-test после npm ci); job residency без установки гонять её НЕ может — и не должен молчать
# об этом, поэтому режим отделён от обычного гейта.
if [ "${1:-}" = "--confront" ]; then
  command -v node >/dev/null 2>&1 || { echo "::error::--confront: node недоступен — сверка НЕ ПРОВЕДЕНА (rc=2, НЕ ЗНАЮ)"; exit 2; }
  [ -d backend/node_modules/ts-node ] || { echo "::error::--confront: backend/node_modules/ts-node нет (npm ci не гонялся?) — сверка НЕ ПРОВЕДЕНА (rc=2, НЕ ЗНАЮ)"; exit 2; }
  parsed=""
  for c in $CONFRONT_CONSTS; do
    vals="$("parse_$c")"
    [ -n "$vals" ] || { echo "::error::--confront: could not parse $c from $env_validation (rc=2, НЕ ЗНАЮ)"; exit 2; }
    while IFS= read -r v; do parsed="$parsed$c $v"$'\n'; done <<<"$vals"
  done
  actual="$(cd backend && CONFRONT_CONSTS="$CONFRONT_CONSTS" node -r ts-node/register/transpile-only -e '
    const m = require("./src/config/env.validation");
    const names = process.env.CONFRONT_CONSTS.split(" ");
    for (const n of names) {
      const v = m[n];
      if (!Array.isArray(v) || v.length === 0) { console.error("missing/empty " + n); process.exit(2); }
      for (const x of v) console.log(n + " " + String(x));
    }' 2>&1)" || { echo "::error::--confront: рантайм не отдал константы (rc=2, НЕ ЗНАЮ):"; echo "$actual"; exit 2; }
  if diff_out="$(diff <(printf '%s' "$parsed" | sort -u) <(printf '%s\n' "$actual" | sort -u))"; then
    echo "✅ confront: текст и рантайм согласны по всем $(echo "$CONFRONT_CONSTS" | wc -w) константам ($(printf '%s' "$parsed" | wc -l) значений)"
    exit 0
  else
    echo "::error::--confront: ТЕКСТ И РАНТАЙМ РАЗОШЛИСЬ — гейт резидентности судит не ту реальность, что работает. «<» = видит только текст-разбор, «>» = видит только рантайм:"
    echo "$diff_out"
    exit 1
  fi
fi

if [ "${1:-}" = "--selftest" ]; then
  work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
  mkdir -p "$work/scripts" "$work/backend/src/config" "$work/deploy"
  cp "${BASH_SOURCE[0]}" "$work/scripts/"
  cp .env.example docker-compose.yml "$work/"; cp deploy/Caddyfile "$work/deploy/"
  fails=0; ran=0
  declared=6
  for c in RF_ALLOWED_REGIONS RF_ALLOWED_HOST_SUFFIXES RF_ALLOWED_STORAGE_HOSTS RF_ALLOWED_PROVIDER_HOSTS \
           RF_DATABASE_URL_SCHEMES RF_REDIS_URL_SCHEMES; do
    sed "s/$c/${c}_RENAMED/g" "$env_validation" > "$work/$env_validation"
    # Стенд самопроверки копирует ТОЛЬКО env.validation.ts — адаптеров в нём нет ПО ПОСТРОЕНИЮ, поэтому
    # ось 6 объявляется пропущенной ЯВНЫМ флагом (иначе новый громкий «двери нет» перебил бы предмет
    # проверки — согласованность констант). Это и есть тот самый явный флаг вместо «молча по каталогу».
    out="$(RF_GATE_EXPECT_ADAPTERS=0 bash "$work/scripts/$(basename "${BASH_SOURCE[0]}")" 2>&1)" && rc=0 || rc=$?
    ran=$((ran+1))
    if [ "$rc" = 2 ] && printf '%s' "$out" | grep -q "could not parse $c"; then
      echo "  ok   $c renamed → rc=2 INCONCLUSIVE, and it says which constant"
    else
      echo "::error::$c renamed → rc=$rc (want 2). A broken coupling must NOT read as a verdict."; fails=$((fails+1))
    fi
  done
  cp "$env_validation" "$work/$env_validation"

  # ═══ МУТАЦИИ ПОЧИНОК (добавлено 17.08.2026). ЗАЧЕМ: круг 2 ре-гейта замерил, что три починки
  # КРИТ-класса не стерегло НИЧТО — мутация «снять потолок» проходила свод зелёной. У кода стражем
  # служит jest; у ЭТОГО скрипта свода не было вовсе, значит каждая его починка держалась ничем.
  # ФОРМА: стенд с НАСТОЯЩЕЙ дверью и подставным объявлением адреса; ось 6 в этих прогонах НЕ
  # пропускается (иначе объявления не сканируются вовсе — на этом первая редакция мутантов и
  # оказалась ложно-зелёной, поймано тем же прогоном).
  mkdir -p "$work/backend/src/lib/providers"
  cp backend/src/lib/providers/http.util.ts "$work/backend/src/lib/providers/"
  # ВТОРАЯ ДВЕРЬ ЕДЕТ В СТЕНД ВМЕСТЕ С ПЕРВОЙ (25.08.2026, находка №122). Реестр вторых дверей
  # двусторонний: он краснеет, если объявленный файл в дереве не найден. Стенд без sentry.ts
  # краснел бы у КАЖДОГО мутанта не по делу — и «красное» перестало бы что-либо доказывать.
  mkdir -p "$work/backend/src/lib/observability"
  cp backend/src/lib/observability/sentry.ts "$work/backend/src/lib/observability/"
  cp "$env_validation" "$work/$env_validation"
  decl="$work/backend/src/lib/providers/_selftest_decls.ts"
  gate_copy="$work/scripts/$(basename "${BASH_SOURCE[0]}")"

  mutant(){ # имя · объявление (пусто = нет файла) · sed по копии гейта (пусто = без порчи) · ожидание FAIL|OK · [что ОБЯЗАН назвать вывод]
    # ПЯТЫЙ ДОВОД ОБЯЗАТЕЛЕН ТАМ, ГДЕ КОДА ВОЗВРАТА МАЛО. Урок круга 3, сформулированный треком:
    # rc=1 не отличает «покраснел ПО ДЕЛУ» от «покраснел ВООБЩЕ» — страж, проверяемый только кодом,
    # принимает любой посторонний отказ за доказательство своей починки. Замерено на userinfo:
    # и с починкой, и без неё гейт даёт rc=1, но БЕЗ починки в выводе стоит «ok outbound endpoint
    # sms.ru» — то есть ложное одобрение видно только в ТЕКСТЕ.
    local name="$1" declline="$2" expr="$3" want="$4" must="${5:-}"
    cp "${BASH_SOURCE[0]}" "$gate_copy"
    [ -n "$expr" ] && sed -i "$expr" "$gate_copy"
    if [ -n "$declline" ]; then printf '%s\n' "$declline" > "$decl"; else rm -f "$decl"; fi
    out="$(cd "$work" && bash "scripts/$(basename "${BASH_SOURCE[0]}")" 2>&1)" && rc=0 || rc=$?
    ran=$((ran+1))
    local said=ok
    if [ -n "$must" ] && ! printf '%s' "$out" | grep -qF "$must"; then said=нет; fi
    if { { [ "$want" = FAIL ] && [ "$rc" = 1 ]; } || { [ "$want" = OK ] && [ "$rc" = 0 ]; }; } && [ "$said" = ok ]; then
      echo "  ok   мутант «$name» → rc=$rc (ожидалось $want)${must:+, и вывод назвал «$must»}"
    elif [ "$said" != ok ]; then
      echo "::error::мутант «$name» → rc=$rc, но вывод НЕ НАЗВАЛ «$must» — красное не доказывает починку"; fails=$((fails+1))
    else
      echo "::error::мутант «$name» → rc=$rc, ожидалось $want — починку НЕ СТЕРЕЖЁТ НИЧТО"; fails=$((fails+1))
    fi
  }
  declared=$((declared+13))  # +2 за мутантов IMDS (IPv4 169.254 и ULA IPv6 в скобках), 20.08.2026
  # ЗАКОННОЕ объявление обязано быть в КАЖДОМ прогоне: без единого объявления гейт по делу
  # говорит «не знаю» (шаблон устарел или адаптеры переписаны) — и первая редакция мутантов
  # ловила именно ЭТОТ красный, а не свой. Поймано этим же прогоном: предмет мутанта обязан
  # быть ОДИН, иначе зелёное и красное перестают что-либо доказывать.
  LEGIT="const OK_ENDPOINT = 'https://sms.ru/sms/send';"
  mutant "стенд-хост mock-sms в объявлении" "$LEGIT
const STAND_ENDPOINT = 'https://mock-sms/v1/send';" "" FAIL
  mutant "collector.localhost в объявлении" "$LEGIT
const EXFIL_URL = 'http://collector.localhost/x';" "" FAIL
  mutant "возврат дыры .localhost в зеркало" "$LEGIT
const EXFIL_URL = 'http://collector.localhost/x';" \
    's@\*\.localhost) \[ "\$no_suffix" = nosuffix \] && return 1 || return 0 ;;@*.localhost) return 0 ;;@' OK
  mutant "только законное объявление — зелено" "$LEGIT" "" OK
  # ЧЕТЫРЕ ПОЧИНКИ, КОТОРЫЕ ШАПКА ОБЪЯВЛЯЛА СТЕРЕЖЁННЫМИ, А МУТАНТОВ НА НИХ НЕ БЫЛО (находка №95,
  # круг 3: замерено 7 порч — краснели 3). Добавлены 20.08.2026; каждый несёт ПЯТЫЙ ДОВОД — что
  # обязан назвать вывод, — потому что rc=1 не отличает «покраснел по делу» от «покраснел вообще».
  # ИМЯ ОБЪЯВЛЕНИЯ ОБЯЗАНО НЕСТИ ENDPOINT|URL|BASE — иначе ось 6a его НЕ ВИДИТ, и мутант краснеет
  # не по делу, а по пустому месту. Первая редакция звалась IMDS и дала rc=0 «зелено»: мутант
  # проверял не то, что назван (мой промах, замерен 20.08 и оставлен здесь как предупреждение).
  # ОСЬ НА САМ РАЗБОР (находка №44). Зовём ТУ ЖЕ функцию, которой пользуется ось 6a — не копию:
  # синтетический кусок литерала, где хост стоит В КОММЕНТАРИИ, а рядом законный. Комментарий не
  # смеет попасть в перечень разрешённых, иначе крит-находка №14 воспроизводится на нашей константе.
  ran=$((ran+1)); declared=$((declared+1))
  parsed="$(printf '%s\n' "  // не разрешаем: 'evil.example.com' — только для пояснения" "  'sms.ru'," "  'api.unisender.com', // хвост-комментарий: 'evil2.example.com'" | strip_comments_and_quote_hosts | tr '\n' ' ')"
  if [ "$parsed" = "api.unisender.com sms.ru " ]; then
    echo "  ok   разбор литерала: комментарий (строкой и хвостом) НЕ попал в перечень — «$parsed»"
  else
    echo "::error::разбор литерала вернул «$parsed», ожидалось «api.unisender.com sms.ru » — комментарий читается как объявление"; fails=$((fails+1))
  fi

  # ВЕРДИКТ И СЧЁТ (находки круга 1 №37 и №38, вылечены 20.08.2026).
  mutant "пропуск оси 6 назван в самом вердикте, а не молчит" "$LEGIT" \
    's@^skipped=""@skipped="ось-проба "@' OK "ПРОПУЩЕНО по объявлению"
  mutant "число прогнанных замков сверяется с ожидаемым" "$LEGIT" \
    's@locks+1@locks+0@g' FAIL "прогнала 0 замков из 3"
  mutant "закрыт 169.254 (IMDS облака) как «своё»" "$LEGIT
const IMDS_URL = 'http://169.254.169.254/latest/meta-data/';" "" FAIL \
    "169.254.169.254"
  mutant "ULA IPv6 в скобках виден оси и закрыт (IPv6-IMDS)" "$LEGIT
const IMDS6_URL = 'http://[fd00:ec2::254]/latest/meta-data/';" "" FAIL \
    "fd00:ec2::254"

  # userinfo: и с починкой, и без неё гейт красен — доказывает ТОЛЬКО текст (см. довод у mutant()).
  mutant "userinfo в объявлении назван по ИСТИННОМУ хосту" "$LEGIT
const EXFIL_ENDPOINT = 'https://sms.ru@evil.example.com/steal';" "" FAIL "evil.example.com"

  # ═══ ТРИ МУТАНТА НА ОСЬ 6b (добавлены 25.08.2026, находка №122). До них ось 6b не стерегло
  # НИЧТО: ни один мутант не заставлял её краснеть, и её слепоту к пакетам с областью имён нашли
  # чужие руки. Каждый несёт ПЯТЫЙ ДОВОД — что обязан назвать вывод.
  rogue="$work/backend/src/lib/providers/_selftest_rogue.ts"
  declared=$((declared+3))
  # (1) КРАСНЫЙ ПОЛЮС НА ГОЛОЕ ИМЯ — доказывает, что ось вообще жива (без него зелёное у (2) не
  #     отличить от «шаблон не сработал вовсе»).
  printf "%s\n" "import https from 'node:https';" "export const rawDoor = https;" > "$rogue"
  mutant "второй клиент голым именем (node:https) виден оси 6b" "$LEGIT" "" FAIL "_selftest_rogue.ts"
  # (2) ТА САМАЯ СЛЕПОТА: пакет С ОБЛАСТЬЮ ИМЁН. Прежний шаблон на этом файле молчал (замерено
  #     на стенде из четырёх файлов: ловил 1 из 4).
  printf "%s\n" "import { S3Client } from '@aws-sdk/client-s3';" "export const scopedDoor = S3Client;" > "$rogue"
  mutant "второй клиент С ОБЛАСТЬЮ ИМЁН (@aws-sdk) виден оси 6b" "$LEGIT" "" FAIL "_selftest_rogue.ts"
  rm -f "$rogue"
  # (3) ВТОРАЯ СТОРОНА РЕЕСТРА: запись, чей файл исчез, ОБЯЗАНА краснеть. Иначе перечень
  #     прощённых протухает молча и завтра прощает чужой файл на месте ушедшего.
  mutant "протухшая запись реестра вторых дверей краснеет" "$LEGIT" \
    's@lib/observability/sentry\.ts|@lib/observability/sentry_GONE.ts|@' FAIL "реестр вторых дверей ПРОТУХ"
  # МУТАНТЫ НА ПОЧИНКИ ОСИ 7 (круг 3 замерил, что обе проходили selftest ЗЕЛЁНЫМИ).
  # Стенд самопроверки несёт .env.example БЕЗ флага, поэтому обе пробы ставят флаг САМИ.
  # ЧИСЛО ПРОБЫ НЕ СМЕЕТ ЗАВИСЕТЬ ОТ ЧУЖОГО ФАЙЛА (найдено прогоном 31.08). Комментарий ниже
  # утверждал «стенд несёт .env.example БЕЗ флага» — и это перестало быть правдой 29.08, когда
  # тумблер задокументировали. Обе пробы ждали «найдено 1» и получали 2: строка шаблона плюс своя.
  # Утверждение о стенде, ставшее ложным от правки в другом файле, — наш класс ADR-0026.
  sed -i '/ALLOW_LOCAL_STAND_HOSTS/d' "$work/.env.example"
  printf '%s\n' "ALLOW_LOCAL_STAND_HOSTS=1" >> "$work/.env.example"
  mutant "флаг в боевой топологии виден" "$LEGIT" "" FAIL
  # ПЯТЫЙ ДОВОД (находка №108: мутант был тавтологичен — при раскомментированном флаге ось краснеет
  # и с починкой, и без неё, доказано соседним мутантом «та же конфигурация без порчи, тот же rc»).
  # Теперь красное обязано НАЗВАТЬ найденное вхождение, а не просто случиться.
  mutant "снят срез номера строки в оси 7" "$LEGIT" 's@  body="${line#\*:}"@  body="$line"@' FAIL \
    "найдено ВКЛЮЧЁННЫХ/неизвестных: 1"
  sed -i '/^ALLOW_LOCAL_STAND_HOSTS=1$/d' "$work/.env.example"
  printf '%s\n' "# ALLOW_LOCAL_STAND_HOSTS=1 — только для стендов, в бою не ставить" >> "$work/.env.example"
  mutant "закомментированный флаг НЕ обвиняется" "$LEGIT" "" OK
  mutant "без среза номера комментарий обвиняется ЛОЖНО" "$LEGIT" 's@  body="${line#\*:}"@  body="$line"@' FAIL \
    "найдено ВКЛЮЧЁННЫХ/неизвестных: 1"
  sed -i '/ALLOW_LOCAL_STAND_HOSTS/d' "$work/.env.example"
  # ═══ ЧЕТЫРЕ МУТАНТА НА ЛЕЧЕНИЕ №176: ОСЬ 7 СУДИТ ЗНАЧЕНИЕ, А НЕ ОБЪЯВЛЕНИЕ ═══
  # До лечения ось обвиняла ЛЮБУЮ незакомментированную строку с этим именем — и держала гейт
  # красным навсегда на `=0`, то есть на СТРОГОМ режиме, заявленном явно. Полюсов четыре, и
  # положительный (явное выключение зелено) поставлен ПЕРВЫМ: без него «красное» у остальных
  # неотличимо от оси, которая краснеет всегда.
  declared=$((declared+4))
  printf '%s\n' "ALLOW_LOCAL_STAND_HOSTS=0" >> "$work/.env.example"
  mutant "явное ВЫКЛЮЧЕНИЕ тумблера — ЗЕЛЕНО (положительный полюс №176)" "$LEGIT" "" OK
  # И красное обязано вернуться, если ось перестанет читать словарь ВЫКЛ (то есть снова начнёт
  # судить по факту объявления). Мутант правит САМУ ОСЬ, а не стенд.
  mutant "ось снова судит объявление, а не значение → ЛОЖНОЕ обвинение на =0" "$LEGIT" \
    's@continue # зелёный полюс 176@:@' FAIL \
    "найдено ВКЛЮЧЁННЫХ/неизвестных: 1"
  sed -i '/^ALLOW_LOCAL_STAND_HOSTS=0$/d' "$work/.env.example"
  # НЕИЗВЕСТНОЕ ЗНАЧЕНИЕ — НЕ «ВЫКЛЮЧЕНО»: опечатка обязана краснеть, а не проходить как строгий режим.
  printf '%s\n' "ALLOW_LOCAL_STAND_HOSTS=off" >> "$work/.env.example"
  mutant "значение ВНЕ словаря («off») краснеет — неизвестное не равно выключенному" "$LEGIT" "" FAIL \
    "НЕ ИЗ СЛОВАРЯ"
  sed -i '/^ALLOW_LOCAL_STAND_HOSTS=off$/d' "$work/.env.example"
  # СКВОЗНАЯ ПЕРЕДАЧА БЕЗ ЗНАЧЕНИЯ (форма compose) — значение приходит из окружения хоста, нам
  # неизвестно, значит красное.
  printf '%s\n' "      - ALLOW_LOCAL_STAND_HOSTS" >> "$work/.env.example"
  mutant "сквозная передача БЕЗ значения краснеет" "$LEGIT" "" FAIL "сквозная передача"
  sed -i '/ALLOW_LOCAL_STAND_HOSTS/d' "$work/.env.example"
  rm -f "$decl"

  cp "$env_validation" "$work/$env_validation"
  if RF_GATE_EXPECT_ADAPTERS=0 bash "$work/scripts/$(basename "${BASH_SOURCE[0]}")" >/dev/null 2>&1; then
    echo "  ok   canon unchanged → rc=0 (the selftest itself removes no capability)"
  else
    echo "::error::canon unchanged → non-zero: the harness is lying, fix it before trusting the gate"; fails=$((fails+1))
  fi
  # ЧИСЛО ПРОГНАННОГО РЯДОМ С ВЕРДИКТОМ, НОЛЬ = «НЕ ЗНАЮ» (ADR-0027, замер Стола 12.08.2026:
  # свод напечатал «OK», прогнав НОЛЬ проверок — всё пропустилось в чужой среде). Здесь была та же
  # дыра структурно: при пустом списке констант `fails` остался бы нулём и selftest сказал бы
  # «passed», ничего не проверив. Ожидаемое число берём из самого списка, а не из памяти.
  echo "  selftest: прогнано констант $ran из объявленных $declared"
  # СЧЁТ ЧЕСТЕН В ОБЕ СТОРОНЫ (находка 20.08: было строго «меньше», и прогон 17 из объявленных 15
  # печатал ✅ — прибор молча описывал себя неверно, а это ровно «утверждение без прибора»).
  # Больше объявленного = кто-то добавил мутанта и не объявил его: сам прибор устарел ⇒ НЕ ЗНАЮ.
  if [ "$ran" = 0 ] || [ "$ran" -lt "$declared" ] || [ "$ran" -gt "$declared" ]; then
    echo "::error::selftest прогнал $ran из $declared — это НЕ ЗНАЮ, а не «passed»"; exit 2
  fi
  [ "$fails" = 0 ] && { echo "✅ selftest passed — this gate can still say \"I don't know\""; exit 0; }
  echo "❌ selftest failed ($fails)"; exit 1
fi

# Extract RF_ALLOWED_REGIONS from the single source of truth.
# `|| true` is LOAD-BEARING, not defensive noise: under `set -euo pipefail` a parse that matches
# nothing makes grep exit 1, the assignment inherits it, and the shell dies BEFORE the guard below —
# silently, with rc=1, which in this gate MEANS "residency violation found". The honest rc=2
# (INCONCLUSIVE) would never be reached, so a renamed constant would read as a verdict.
# Measured on an isolated harness 09.08.2026 (rename → rc=1, zero output). Same law as
# check-seed-parity.sh: setup failure must never be byte-identical to a verdict.
# ШАБЛОН ТЕРПИТ ОБЕ ФОРМЫ ОБЪЯВЛЕНИЯ (`= [` и `= Object.freeze([`). 17.08 перечни были заморожены по
# находке безопасника, форма объявления изменилась — и гейт немедленно перестал их разбирать, выйдя
# rc=2 «could not parse». Прибор сработал ВЕРНО (честное «не знаю» вместо вердикта), но это ещё один
# flag_form «лечение в одном файле ломает прибор в другом»: шаблон, привязанный к форме записи чужого
# языка, хрупок по построению. Терпимость к обеим формам — заплата; наwhy_red лечение (разбор через
# tsc/ts-node, а не sed) названо долгом.
# 🔴 КЛАСС ПОВТОРИЛСЯ 24.08.2026, ТРЕТИЙ РАЗ: перечни переехали на ДВЕРЬ `sanitizedHostList([...])`
# (находка №119 — пустой элемент перечня совпадает со ВСЕМ, лечим рождение перечня, а не каждого
# читателя), и гейт снова выдал rc=2 «could not parse». Прибор опять сработал верно, а заплата
# опять расширена третьей формой. Пока разбор идёт sed'ом по чужому языку, КАЖДОЕ лечение в
# env.validation.ts обязано проверять ЭТОТ файл — иначе лечение чинит дом и ломает сторожа.
allow="$(parse_RF_ALLOWED_REGIONS)"
[ -n "$allow" ] || { echo "::error::could not parse RF_ALLOWED_REGIONS from $env_validation"; exit 2; }
echo "RF allowlist (from $env_validation): $(echo "$allow" | tr '\n' ' ')"

is_allowed() { grep -qxF "$1" <<<"$allow"; }

# Config files that describe the deployed (prod) topology. Add IaC (terraform/*.tf, helm values,
# k8s manifests) here as they are introduced.
files=()
for f in .env.example docker-compose.yml deploy/Caddyfile; do
  [ -f "$f" ] && files+=("$f")
done
[ "${#files[@]}" -gt 0 ] || { echo "::error::no deploy config files found to scan"; exit 2; }

fail=0
# СЧЁТЧИКИ ПРОГНАННОГО ПО ОСЯМ (ADR-0027, «ноль прогнанных = НЕ ЗНАЮ»). Оси 1/3/4 построены как
# while read … < <(grep … || true): не совпало ничего — тело цикла не выполнилось, и гейт печатал
# «✅ every value is RF-resident», НЕ ИЗМЕРИВ НИ ОДНОГО. Замерено backend-лейном на круге 2: удалить
# четыре строки из .env.example — rc=0 и зелёный вердикт; при этом ПУСТОЕ flag_line той же строки
# краснеет. То есть ОТСУТСТВИЕ переменной было разрешительнее её обнуления — наоборот безопасному
# направлению. Лечение уже было написано в этом же файле (check_dsn_var, «silence must not read as
# green») и применено к двум переменным из шести.
seen_region=0; seen_dsn=0; seen_s3=0; seen_cdn=0

# (1) Every `*_REGION` assignment must be an approved RF region. Handles `KEY=value` (env) and
#     `KEY: value` / `KEY=value` (compose). Comment lines (leading #) are ignored.
while IFS= read -r hit; do
  file="${hit%%:*}"; line="${hit#*:}"
  # НОМЕР СТРОКИ ОТРЕЗАЕТСЯ ДО ПРОВЕРКИ НА КОММЕНТАРИЙ (как в пяти соседних циклах и в оси 7).
  # Без второго среза в `line` оставалось ведущее «номер:», и комментарий не распознавался
  # НИКОГДА: закомментированная строка региона давала отказ, ПОБУКВЕННО равный ответу на живое
  # присваивание того же значения (замерено кругом 3).
  line="${line#*:}"
  case "$(echo "$line" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  # СЧЁТЧИК СВОЕЙ ОСИ И ТОЛЬКО ПОСЛЕ ФИЛЬТРА КОММЕНТАРИЯ. Круг 2 поставил здесь ЧЕТЫРЕ инкремента
  # (свой и ТРИ ЧУЖИХ) ДО фильтра — и тем воспроизвёл ровно ту дыру, которую закрывал: оси 3/4a/4b
  # своих счётчиков не вели вовсе, а одна закомментированная строка удовлетворяла все четыре.
  seen_region=$((seen_region+1))
  value="$(echo "$line" | grep -oE '[A-Z0-9_]*_REGION[[:space:]]*[:=][[:space:]]*"?[A-Za-z0-9-]+' \
           | sed -E 's/.*[:=][[:space:]]*"?//' | tr -d '"' || true)"   # `|| true` НЕСУЩИЙ: пустое flag_line под set -e убивало ОБОЛОЧКУ, и гейт выходил rc=1 — код «нарушение найдено». Предпосылка круга 2 «пустое краснеет» была верна ПО СЛУЧАЙНОСТИ (круг 3)
  # ПУСТОЕ ЗНАЧЕНИЕ РЕГИОНА — ЭТО НЕ «ok» И НЕ «пропустить». Регион объявлен, но не назван: замерить
  # нечего, а промолчать значило бы засчитать замер, которого не было (счётчик выше уже сработал).
  # Круг 3 замерил, что прежде такая строка РОНЯЛА гейт под set -e, и это читалось как «нарушение».
  if [ -z "$value" ]; then
    echo "::error::$file: *_REGION объявлен, но ПУСТ — измерить нечего. Это «НЕ ЗНАЮ», а не «ok» (ADR-0027)"; fail=1
    continue
  fi
  if is_allowed "$value"; then
    echo "  ok   $file: *_REGION=$value"
  else
    echo "::error file=$file::region-bearing value '$value' is NOT an approved RF region (ADR-0017 / ФЗ-152 ст.18 ч.5). Allowed: $(echo "$allow" | tr '\n' ' ')"
    fail=1
  fi
done < <(grep -nHE '[A-Z0-9_]*_REGION[[:space:]]*[:=]' "${files[@]}" || true)
if [ "${seen_region}" -eq 0 ]; then
  echo "::error::ось «*_REGION»: ПРОГНАНО НОЛЬ ЗАМЕРОВ — переменная не найдена ни в одном сканируемом файле. Это НЕ «чисто», это «НЕ ЗНАЮ» (ADR-0027): отсутствие значения не смеет читаться разрешительнее, чем пустое flag_line"; fail=1
fi

# (2) Broad net: any foreign cloud-region token embedded anywhere in prod config (e.g. inside an
#     endpoint/host) is a residency red flag. Matches AWS/GCP/Azure-style `<geo>-<dir>-<n>`.
#
#     `-[0-9]+\b` and NOT `-[0-9]\b`: measured 2026-08-09, the single-digit form MISSED
#     `s3.us-west-004.backblazeb2.com` — after the `0` comes another `0`, which is a word character, so
#     `\b` never held and the zero-padded Backblaze region sailed past. The axis was catching foreign
#     regions only when the digit run happened to be one digit long, i.e. by luck. Widening it to `+`
#     was measured for false positives across every scanned config plus ci.yml, performance-tests.yml
#     and deploy/gen-env.sh: it adds exactly ONE new hit, on a COMMENT line of .env.example that this
#     loop already skips. Zero false positives on a live assignment.
foreign='\b(us|eu|ap|sa|ca|af|me)-(east|west|central|north|south|southeast|northeast|northwest|southwest|northcentral|southcentral)-[0-9]+\b'
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
  case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  echo "::error file=$file::foreign cloud-region token in prod config: '$(echo "$content" | grep -oE "$foreign" | head -1)' (ADR-0017 — PII-bearing stores must be RF-resident)"
  fail=1
done < <(grep -nHiE "$foreign" "${files[@]}" || true)

# (3) ADR-0017 clause 6 — the PII-bearing observability sink. `SENTRY_DSN` names a HOST,
#     not a region, so neither (1) nor (2) can see it: a foreign Sentry ingest
#     (`https://<key>@o0.ingest.sentry.io/1`) contains no `*_REGION` and no `us-east-1` token, yet it
#     ships stack traces — and the PII inside them — across the border. EMPTY value = sink disabled
#     (lawful, and the MVP default). Allowlist comes from the SAME single source of truth as the
#     regions: RF_ALLOWED_HOST_SUFFIXES in env.validation.ts.
suffixes="$(parse_RF_ALLOWED_HOST_SUFFIXES)"
[ -n "$suffixes" ] || { echo "::error::could not parse RF_ALLOWED_HOST_SUFFIXES from $env_validation"; exit 2; }

# Approved RF provider hosts that do NOT sit under an RF TLD (today: Yandex Object Storage). Used ONLY
# by the storage/CDN axis — an object store is not an error sink, so the DSN axis must stay narrower.
# РАЗБИРАЕМ ОДНОСТРОЧНОЕ ОБЪЯВЛЕНИЕ, НЕ sed-ДИАПАЗОНОМ. Диапазон `/начало/,/конец/` НЕ закрывается на
# СТАРТОВОЙ строке: у однострочной константы `[...]` он не находил `]` на той же строке и добегал до
# `]` СЛЕДУЮЩЕГО блока (RF_ALLOWED_PROVIDER_HOSTS) — allowlist хранилищ ТИХО расширялся с 1 хоста до 5,
# и `MEDIA_CDN_HOST=api.unisender.com` начинал проходить (замерено A/B, регрессия оси 4, ADR-0017).
# Константа объявлена на ОДНОЙ строке → берём именно её.
storage_hosts="$(parse_RF_ALLOWED_STORAGE_HOSTS)"
[ -n "$storage_hosts" ] || { echo "::error::could not parse RF_ALLOWED_STORAGE_HOSTS from $env_validation"; exit 2; }
echo "RF host suffixes: $(echo "$suffixes" | tr '\n' ' ')| approved provider hosts: $(echo "$storage_hosts" | tr '\n' ' ')"

# Mirrors isResidentHost() in env.validation.ts. Fail-closed: only positively-recognised self-hosted
# (loopback / RFC1918 / IPv6-ULA / single-label service name), RF-suffixed, or (when $2 = "storage")
# explicitly-approved provider hosts pass.
host_resident_ok() {
  local h allow_storage
  h="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  allow_storage="${2:-}"
  # РЕЖИМ «БЕЗ СУФФИКСОВ» — для оси 6a (объявленные в КОДЕ адреса). Дверь в рантайме зовёт
  # isAllowedProviderHost, то есть isResidentHost с allowRfSuffixes:false: РФ-домен сам по себе
  # дверь НЕ открывает, нужен явный перечень. Гейт же звал зеркало с суффиксами и потому объявлял
  # «заведомо своим» ЛЮБОЙ зашитый в код .ru-адрес. ЗАМЕРЕНО (reviewer-qa, ре-гейт 15.08):
  # const ENDPOINT = https://api.sberbank.ru/x → «ok outbound endpoint (заведомо своё)», rc=0,
  # тогда как дверь его ОТКАЗЫВАЕТ и http.util.spec держит этот адрес как обязательный отказ.
  # Слой-2 был РАЗРЕШАЮЩЕЕ слоя-1 на самом вероятном случае — новом РФ-провайдере.
  no_suffix="${3:-}"
  h="${h%.}"; h="${h#[}"; h="${h%]}"
  [ -n "$h" ] || return 1
  case "$h" in
    localhost) return 0 ;;
    # `*.localhost` — «своё» только для РЕЗИДЕНТНОСТИ. Для объявлений исходящих адресов (режим
    # nosuffix, ось 6a) оно закрыто, как и в двери: имя разрешает резолвер МАШИНЫ, и в нашем же
    # образе node:20-alpine `evil.localhost` спокойно резолвится в чужой адрес (замерено круг 2).
    *.localhost) [ "$no_suffix" = nosuffix ] && return 1 || return 0 ;;
    ::1|0:0:0:0:0:0:0:1) return 0 ;;
    # ULA/link-local IPv6 — «своё» ТОЛЬКО для резидентности. Для объявлений исходящих (nosuffix)
    # закрыто, как в двери с outbound:true: IPv6-IMDS живёт В САМОЙ ULA (`fd00:ec2::254` у AWS),
    # и зеркало без этой строки объявляло бы «заведомо своим» ровно тот адрес, который дверь
    # ОТКАЗЫВАЕТ — расхождение слоёв в РАЗРЕШАЮЩУЮ сторону (находка круга 4, семейство №107).
    f[cd]*:*|fe80:*) [ "$no_suffix" = nosuffix ] && return 1 || return 0 ;;
    *:*) return 1 ;;                                        # any other IPv6 literal
  esac
  # ЛИТЕРАЛ ЛИ ЭТО ВООБЩЕ — РЕШАЕТСЯ ПЕРВЫМ (находка ре-гейта 15.08, две ленты независимо).
  # Было наоборот: глобы приватных диапазонов стояли ВЫШЕ этой проверки, а в `case` точка — обычный
  # символ, поэтому `10.evil.com`, `127.attacker.example.com`, `192.168.evil.com`, `172.31.evil.com`
  # и даже `127.0.0.1.evil.com` объявлялись РЕЗИДЕНТНЫМИ. ЗАМЕРЕНО: гейт печатал по каждому
  # «ok … (RF-resident / self-hosted)» и выходил rc=0 с итоговым «every value is RF-resident», тогда
  # как TS-зеркало (`isResidentHost`) их ОТВЕРГАЕТ — то есть слой 2 расходился со слоем 1 в
  # РАЗРЕШАЮЩУЮ сторону, ровно на том классе, ради которого гейт и написан. Шапка файла при этом
  # утверждала «layer 1 and this CI gate can never diverge» — утверждение опровергнуто замером.
  # Форма квартета берётся строгая (1-3 цифры в каждом октете), как в TS: `10.evil.com` в неё не
  # попадает и уходит в общий разбор имён ниже.
  if printf '%s' "$h" | grep -Eq '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
    case "$h" in
      127.*|10.*) return 0 ;;                               # 169.254/16 закрыт: IMDS облака, см. TS-зеркало
      192.168.*) return 0 ;;
      172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
      *) return 1 ;;                                        # любой другой голый IPv4 — не проверяем
    esac
  fi
  # ОДНИ ЦИФРЫ — IPv4 В ДЕСЯТИЧНОЙ ФОРМЕ, А НЕ ИМЯ (находка №51; зеркало обязано совпасть с TS).
  case "$h" in
    ''|*[!0-9]*) : ;;
    *) return 1 ;;
  esac
  # ОДНОСЕГМЕНТНОЕ ИМЯ. Для резидентности — своё (контейнер/LAN). Для ОБЪЯВЛЕНИЙ исходящих адресов
  # (nosuffix) — НЕТ: дверь с 17.08 пускает такие имена только при явном ALLOW_LOCAL_STAND_HOSTS, а
  # гейт про флаг не знал и печатал «ok (заведомо своё)» на том, что дверь ОТКАЗЫВАЕТ. Слой 2 был
  # разрешительнее слоя 1 ровно на новом правиле (замерено двумя лейнами круга 2). Шапка файла
  # обещает, что слои «can never diverge» — эта строка и есть плата за обещание.
  case "$h" in
    *.*) ;;
    *) [ "$no_suffix" = nosuffix ] && return 1 || return 0 ;;
  esac
  if [ "$allow_storage" = storage ]; then
    while IFS= read -r sh; do
      [ -n "$sh" ] || continue
      # Exact host or a real subdomain of it — the leading '.' is what stops
      # `storage.yandexcloud.net.evil.com` from passing as a subdomain.
      case "$h" in "$sh"|*".$sh") return 0 ;; esac
    done <<<"$storage_hosts"
  fi
  [ "$no_suffix" = nosuffix ] && return 1
  while IFS= read -r sfx; do
    # ПУСТАЯ СТРОКА ЗДЕСЬ ОТКРЫВАЛА ВСЁ: шаблон `*""` — это `*`, и он совпадает с ЛЮБЫМ хостом.
    # Значит при пустом (или недоразобранном) перечне суффиксов функция объявляла резидентным
    # что угодно — fail-OPEN ровно в том месте, которое стережёт границу. У соседнего цикла по
    # storage-хостам такая страховка стоит (`[ -n "$sh" ] || continue`), здесь её не было.
    # Найдено 17.08.2026 при лечении: мой же пробник с пустым перечнем показал «резидент» на всех
    # 15 адресах, включая 8.8.8.8 — то есть дыру видно ровно тогда, когда прибор берут В РУКИ.
    [ -n "$sfx" ] || continue
    case "$h" in *"$sfx") return 0 ;; esac
  done <<<"$suffixes"
  return 1
}

# Telemetry sinks get NO provider carve-out (clause 6 stays narrower than clause 4).
telemetry_host_ok() { host_resident_ok "$1"; }

while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
  case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  seen_dsn=$((seen_dsn+1))   # счётчик СВОЕЙ оси, ПОСЛЕ фильтра комментария (круг 3: раньше его вёл чужой цикл)
  value="$(printf '%s' "$content" \
           | sed -E 's/.*SENTRY_DSN[[:space:]]*[:=][[:space:]]*//' \
           | tr -d "\"'" | sed -E 's/[[:space:]].*$//')"
  if [ -z "$value" ]; then
    echo "  ok   $file: SENTRY_DSN empty (error sink disabled)"
    continue
  fi
  # Fail-CLOSED on a value we cannot read as an http(s) DSN — mirrors the `unparseable` branch of
  # checkTelemetryDsn(). Without this, a garbage value would fall through the single-label rule and
  # the gate would go green on config the boot validator rejects (layer 1 / layer 2 divergence).
  case "$value" in
    http://*|https://*|HTTP://*|HTTPS://*) ;;
    *)
      echo "::error file=$file::SENTRY_DSN is set but is not a parseable http(s) DSN — refusing (fail-closed): an unverifiable error sink cannot be shown to be RF-resident (ADR-0017 п.6). Leave it empty to disable error reporting."
      fail=1; continue ;;
  esac
  # Host only — never echo the DSN itself, it carries a credential. Real URL shape is honoured
  # (scheme, then userinfo up to '@'), because the public key sits BEFORE the host in a DSN.
  host="$(printf '%s' "$value" \
          | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#^[^/@]*@##; s#[/?\#].*$##; s#:[0-9]+$##')"
  if [ -z "$host" ]; then
    echo "::error file=$file::SENTRY_DSN is set but no ingest host could be extracted — refusing (fail-closed, ADR-0017 п.6)."
    fail=1; continue
  fi
  if telemetry_host_ok "$host"; then
    echo "  ok   $file: SENTRY_DSN host=$host (RF-resident / self-hosted)"
  else
    echo "::error file=$file::error-sink host '$host' is NOT RF-resident (ADR-0017 п.6 / ФЗ-152 ст.18 ч.5) — stack traces carry PII. Allowed: self-hosted (loopback/private/single-label) or $(echo "$suffixes" | tr '\n' ' ')"
    fail=1
  fi
done < <(grep -nHE '(^|[^A-Z0-9_])SENTRY_DSN[[:space:]]*[:=]' "${files[@]}" || true)
if [ "${seen_dsn}" -eq 0 ]; then
  echo "::error::ось «SENTRY_DSN»: ПРОГНАНО НОЛЬ ЗАМЕРОВ — переменная не найдена ни в одном сканируемом файле. Это НЕ «чисто», это «НЕ ЗНАЮ» (ADR-0027): отсутствие значения не смеет читаться разрешительнее, чем пустое flag_line"; fail=1
fi

# Extracts the value of KEY from a `KEY=value` / `KEY: value` config line: strips the assignment,
# quotes, and any trailing inline comment / whitespace. Same shape as the DSN extraction above.
config_value() {   # $1 = raw line content, $2 = key name
  printf '%s' "$1" \
    | sed -E "s/.*$2[[:space:]]*[:=][[:space:]]*//" \
    | tr -d "\"'" | sed -E 's/[[:space:]].*$//'
}

# (4) ADR-0017 clause 4 — the PII-bearing OBJECT STORE and the CDN in front of it. Neither carries a
#     region: `S3_REGION=ru-central1` sat green while `S3_ENDPOINT` pointed at a Backblaze US-West
#     bucket (measured). `MEDIA_CDN_HOST` is worse than the bucket — its host is ADDED to the
#     media-URL allowlist, so a foreign CDN caches and serves avatars (PII, ADR-0012) abroad.
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
  case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  seen_s3=$((seen_s3+1))   # счётчик СВОЕЙ оси, ПОСЛЕ фильтра комментария (круг 3: раньше его вёл чужой цикл)
  value="$(config_value "$content" S3_ENDPOINT)"
  # Fail-CLOSED on anything that is not an http(s) URL — mirrors the `unparseable` branch of
  # checkStorageEndpoint(). Empty is NOT a lawful mode here: the app cannot store media without a
  # bucket, so an empty endpoint is an error, not a "disabled" state.
  case "$value" in
    http://*|https://*|HTTP://*|HTTPS://*) ;;
    *)
      echo "::error file=$file::S3_ENDPOINT is not a parseable http(s) endpoint — refusing (fail-closed): an object store whose host cannot be read cannot be shown to be RF-resident (ADR-0017 п.4). Use http(s)://host[:port], e.g. http://minio:9000."
      fail=1; continue ;;
  esac
  # Host only. Real URL shape is honoured (scheme, then userinfo up to '@'), because
  # `https://ru.example.com@evil.com/` resolves to evil.com while satisfying any substring check.
  host="$(printf '%s' "$value" \
          | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#^[^/@]*@##; s#[/?\#].*$##; s#:[0-9]+$##')"
  if [ -z "$host" ]; then
    echo "::error file=$file::S3_ENDPOINT is set but no host could be extracted — refusing (fail-closed, ADR-0017 п.4)."
    fail=1; continue
  fi
  if host_resident_ok "$host" storage; then
    echo "  ok   $file: S3_ENDPOINT host=$host (RF-resident / self-hosted)"
  else
    echo "::error file=$file::object-storage host '$host' is NOT RF-resident (ADR-0017 п.4 / ФЗ-152 ст.18 ч.5) — the bucket holds provider documents, avatars and listing photos. Allowed: self-hosted (loopback/private/single-label such as minio:9000), $(echo "$suffixes" | tr '\n' ' ')or an approved provider host ($(echo "$storage_hosts" | tr '\n' ' '))"
    fail=1
  fi
done < <(grep -nHE '(^|[^A-Z0-9_])S3_ENDPOINT[[:space:]]*[:=]' "${files[@]}" || true)
if [ "${seen_s3}" -eq 0 ]; then
  echo "::error::ось «S3_ENDPOINT»: ПРОГНАНО НОЛЬ ЗАМЕРОВ — переменная не найдена ни в одном сканируемом файле. Это НЕ «чисто», это «НЕ ЗНАЮ» (ADR-0027): отсутствие значения не смеет читаться разрешительнее, чем пустое flag_line"; fail=1
fi

while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
  case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
  seen_cdn=$((seen_cdn+1))   # счётчик СВОЕЙ оси, ПОСЛЕ фильтра комментария (круг 3: раньше его вёл чужой цикл)
  value="$(config_value "$content" MEDIA_CDN_HOST)"
  if [ -z "$value" ]; then
    echo "  ok   $file: MEDIA_CDN_HOST empty (no CDN — media served from the S3 origin)"
    continue
  fi
  # A BARE host[:port] and nothing else — mirrors checkMediaCdnHost(). Rejecting these characters
  # before any parsing is what stops `https://cdn.zoolink.ru`, `evil.com/cdn.zoolink.ru`,
  # `key@evil.com` and `evil.com%2f.ru` from reaching the suffix test dressed as a host.
  case "$value" in
    *[!A-Za-z0-9._:\[\]-]*)
      echo "::error file=$file::MEDIA_CDN_HOST must be a bare host[:port] — no scheme, no path, no credentials (e.g. cdn.zoolink.ru) — refusing (fail-closed, ADR-0017 п.4). Leave it empty to serve media straight from the S3 origin."
      fail=1; continue ;;
  esac
  host="$(printf '%s' "$value" | sed -E 's#^\[([^]]*)\](:[0-9]+)?$#\1#; s#:[0-9]+$##')"
  if [ -z "$host" ]; then
    echo "::error file=$file::MEDIA_CDN_HOST is set but no host could be extracted — refusing (fail-closed, ADR-0017 п.4)."
    fail=1; continue
  fi
  if host_resident_ok "$host" storage; then
    echo "  ok   $file: MEDIA_CDN_HOST host=$host (RF-resident / self-hosted)"
  else
    echo "::error file=$file::media CDN host '$host' is NOT RF-resident (ADR-0017 п.4 / ФЗ-152 ст.18 ч.5) — this host is ADDED to the media-URL allowlist, so it would cache and serve avatars and listing photos (personal data, ADR-0012) from outside the RF. Allowed: self-hosted (loopback/private/single-label), $(echo "$suffixes" | tr '\n' ' ')or an approved provider host ($(echo "$storage_hosts" | tr '\n' ' ')). Empty = no CDN."
    fail=1
  fi
done < <(grep -nHE '(^|[^A-Z0-9_])MEDIA_CDN_HOST[[:space:]]*[:=]' "${files[@]}" || true)
if [ "${seen_cdn}" -eq 0 ]; then
  echo "::error::ось «MEDIA_CDN_HOST»: ПРОГНАНО НОЛЬ ЗАМЕРОВ — переменная не найдена ни в одном сканируемом файле. Это НЕ «чисто», это «НЕ ЗНАЮ» (ADR-0027): отсутствие значения не смеет читаться разрешительнее, чем пустое flag_line"; fail=1
fi

# (5) ADR-0017 clause 1 — the PRIMARY store of personal data (`DATABASE_URL`) and the cache/throttler
#     store in front of it (`REDIS_URL`). Same class as (3) and (4), heaviest member: neither DSN
#     carries a region string, so axes (1) and (2) are blind to them except by accident — measured
#     2026-08-09, `ep-x.aws.neon.tech` + `eu2-x.upstash.io` produced rc=0 with no output at all.
#     Accepted schemes come from the SAME single source of truth as every other list.
db_schemes="$(parse_RF_DATABASE_URL_SCHEMES)"
[ -n "$db_schemes" ] || { echo "::error::could not parse RF_DATABASE_URL_SCHEMES from $env_validation"; exit 2; }
redis_schemes="$(parse_RF_REDIS_URL_SCHEMES)"
[ -n "$redis_schemes" ] || { echo "::error::could not parse RF_REDIS_URL_SCHEMES from $env_validation"; exit 2; }
echo "DSN schemes: db=$(echo "$db_schemes" | tr '\n' ' ')| redis=$(echo "$redis_schemes" | tr '\n' ' ')"

# Percent-decode, fail-closed. Mirrors decodeURIComponent() in dsnHostTarget(): a `%` that is not part
# of a valid `%XX` escape makes the value unreadable, and unreadable is unclearable — so we return 1
# rather than passing the raw text on to the host rules.
pct_decode() {
  local s="$1" stripped
  case "$s" in
    *%*) ;;
    *) printf '%s' "$s"; return 0 ;;
  esac
  stripped="$(printf '%s' "$s" | sed -E 's/%[0-9A-Fa-f]{2}//g')"
  case "$stripped" in *%*) return 1 ;; esac
  # Backslashes are escaped first so printf '%b' cannot reinterpret them as its own escapes.
  printf '%b' "$(printf '%s' "$s" | sed -E 's/\\/\\\\/g; s/%([0-9A-Fa-f]{2})/\\x\1/g')"
}

# One `host[:port]` piece → the target a client connects to. Mirrors dsnHostTarget() in
# env.validation.ts, INCLUDING the order: the percent-decode comes FIRST, so libpq's
# unix-socket-in-the-host-slot form (`postgresql://%2Fvar%2Frun%2Fpostgresql/db`) is recognised as a
# LOCAL socket instead of being judged as a DNS name — which would reject a socket path with a dot in it.
dsn_one_host() {
  local piece="$1" decoded h
  decoded="$(pct_decode "$piece")" || return 1
  case "$decoded" in /*) printf 'unix:%s' "$decoded"; return 0 ;; esac
  case "$piece" in
    \[*\]*) h="${piece#\[}"; h="${h%%\]*}" ;;   # bracketed IPv6 literal; the :port after ] is dropped
    *) h="${piece%%:*}" ;;                      # host[:port]
  esac
  h="$(pct_decode "$h")" || return 1
  [ -n "$h" ] || return 1
  printf '%s' "$h"
}

# Every connection target a DSN names, one per line (`unix:<path>` for a socket). Returns 1 (printing
# nothing) when the value cannot be read under an approved scheme — the caller MUST treat that as
# fail-closed, exactly like the `unparseable` verdict of checkDsnResidency().
#
# Hand-parsed for the same two reasons the TS twin is: the libpq MULTI-HOST form
# (`postgres://u:p@a,b/db`) is one string to a URL parser, so `localhost,ep-abroad` would read as a
# dotless "service name"; and the `?host=` form puts the real target in the QUERY, where a host parser
# never looks. Both are split and every piece is checked — ANY of them may be the one that serves.
dsn_targets() {   # $1 = dsn, $2 = newline-separated allowed schemes
  local dsn="$1" schemes="$2" scheme rest authority query hostlist piece h kv k v found=0 ok=0 s
  case "$dsn" in *://*) ;; *) return 1 ;; esac
  scheme="$(printf '%s' "$dsn" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*)://.*$#\1#' | tr '[:upper:]' '[:lower:]')"
  while IFS= read -r s; do [ "$scheme" = "$s" ] && ok=1; done <<<"$schemes"
  [ "$ok" = 1 ] || return 1
  rest="${dsn#*://}"
  authority="$(printf '%s' "$rest" | sed -E 's#[/?#].*$##')"
  query=""
  case "$rest" in *\?*) query="${rest#*\?}"; query="${query%%#*}" ;; esac
  hostlist="${authority##*@}"    # userinfo dropped at the LAST '@' — the delimiter WHATWG/libpq use, so
                                 # a host-shaped credential can never be mistaken for the host
  while IFS= read -r piece; do
    [ -n "$piece" ] || continue
    h="$(dsn_one_host "$piece")" || return 1
    printf '%s\n' "$h"; found=1
    # `printf '%s\n'` and NOT `printf '%s'`: measured 2026-08-09 — without the trailing newline `read`
    # returns EOF on the FINAL (only) piece, the loop body never runs, `found` stays 0 and a perfectly
    # good `postgres:5432` was reported as "no readable host". Fail-closed, so the direction was safe,
    # but the verdict was wrong on the live config. Same fix applies to the two `host=` loops below.
  done < <(printf '%s\n' "$hostlist" | tr ',' '\n')
  if [ -n "$query" ]; then
    while IFS= read -r kv; do
      case "$kv" in *=*) ;; *) continue ;; esac
      k="$(printf '%s' "${kv%%=*}" | tr '[:upper:]' '[:lower:]')"
      [ "$k" = host ] || continue
      v="${kv#*=}"
      while IFS= read -r piece; do
        [ -n "$piece" ] || continue
        piece="$(pct_decode "$piece")" || return 1
        case "$piece" in
          /*) printf 'unix:%s\n' "$piece"; found=1; continue ;;
        esac
        h="$(dsn_one_host "$piece")" || return 1
        printf '%s\n' "$h"; found=1
      done < <(printf '%s\n' "$v" | tr ',' '\n')
    done < <(printf '%s\n' "$query" | tr '&' '\n')
  fi
  # No target at all (`postgres://`, `redis://`) — a store whose location the config does not state is
  # a store whose location cannot be cleared.
  [ "$found" = 1 ] || return 1
}

# Runs axis (5) for ONE variable. $1 = var name, $2 = allowed schemes, $3 = the "why it holds PII"
# sentence for the error message. Sets `fail` and `seen_<var>` in the caller's scope.
check_dsn_var() {
  local var="$1" schemes="$2" why="$3" hit file rest content value targets t seen=0
  while IFS= read -r hit; do
    file="${hit%%:*}"; rest="${hit#*:}"; content="${rest#*:}"
    case "$(echo "$content" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
    value="$(config_value "$content" "$var")"
    seen=1
    if ! targets="$(dsn_targets "$value" "$schemes")"; then
      echo "::error file=$file::$var names no readable host under an approved scheme ($(echo "$schemes" | tr '\n' ' ')) — refusing (fail-closed): $why cannot be shown to be RF-resident if its location cannot be read (ADR-0017 п.1 / ФЗ-152 ст.18 ч.5)."
      fail=1; continue
    fi
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      case "$t" in
        unix:*) echo "  ok   $file: $var target=$t (local unix socket)"; continue ;;
      esac
      if host_resident_ok "$t"; then
        echo "  ok   $file: $var host=$t (RF-resident / self-hosted)"
      else
        # The DSN itself is NEVER echoed — it carries the database/Redis password.
        echo "::error file=$file::$var host '$t' is NOT RF-resident (ADR-0017 п.1 / ФЗ-152 ст.18 ч.5) — $why. Allowed: self-hosted (loopback/private/single-label service name such as postgres:5432 / redis:6379 / a unix socket) or $(echo "$suffixes" | tr '\n' ' ')"
        fail=1
      fi
    done <<<"$targets"
  done < <(grep -nHE "(^|[^A-Z0-9_])$var[[:space:]]*[:=]" "${files[@]}" || true)
  # Neither variable has a lawful "absent" mode (both are boot-required with no default), so finding
  # NO assignment at all is a broken scan, not a clean bill of health: silence must not read as green.
  if [ "$seen" = 0 ]; then
    echo "::error::$var was not found in any scanned prod config ($(printf '%s ' "${files[@]}")) — refusing (fail-closed): it is boot-required, so its absence means this axis measured nothing (ADR-0017 п.1)."
    fail=1
  fi
}

check_dsn_var DATABASE_URL "$db_schemes" \
  "DATABASE_URL is the PRIMARY store of personal data (accounts, phone_hash, encrypted email/contact_phone per ADR-0012, listings, consents, the moderation audit trail)"
check_dsn_var REDIS_URL "$redis_schemes" \
  "Redis holds the rate-limit/throttler counters keyed by phone/IP, the per-user listing quota and cached profile/listing payloads — personal data derived from the primary store"

# (6) ADR-0017 — ИСХОДЯЩИЙ ПЕРИМЕТР, ЗАШИТЫЙ В КОД. Оси (1)-(5) читают ПЕРЕМЕННЫЕ, а адрес,
#     вписанный прямо в адаптер, им не виден ПО ПОСТРОЕНИЮ: до 13.08.2026 гейт его не видел вовсе.
#     Три замка, каждый на свой способ обойти дверь:
#       6a. ОБЪЯВЛЕНИЯ адресов (const …ENDPOINT/URL/BASE… = 'http…') покрыты RF_ALLOWED_PROVIDER_HOSTS.
#           ПРЕДЕЛ НАЗЫВАЮ ПРЯМО: сканируются ОБЪЯВЛЕНИЯ, а не любой литерал. Первая редакция брала
#           любое вхождение "http://…" и краснела на нашем же `zoolink.ru` ИЗ КОММЕНТАРИЯ и на
#           строках ТЕСТОВ — 20 ложных тревог. Адаптер, назвавший переменную иначе, этой осью не
#           поймается: его ловит замок в двери (6c) во время работы, fail-closed. Ось 6a — про
#           ВИДИМОСТЬ периметра в CI, а не про сам запрет.
#       6b. ОДНА ДВЕРЬ: иных сетевых клиентов нет и прямого fetch() вне шва нет.
#       6c. ЗАМОК В ДВЕРИ НА МЕСТЕ: http.util.ts сверяет хост ДО запроса.
# КОММЕНТАРИЙ — НЕ ДАННЫЕ. Разбор снимает строки-комментарии (`//`) и хвосты после `//` ДО того,
# как ищет кавычки. Без этого ЗАМЕРЕНО (reviewer-qa, ре-гейт 15.08): строка внутри литерала
#   «…не разрешаем: 'evil.example.com' — только для пояснения»
# попадала в ПЕРЕЧЕНЬ РАЗРЕШЁННЫХ, и гейт печатал её среди хостов, выходя rc=0. Это тот же класс,
# что крит-находка №14 (sed-диапазон захватил чужой блок), воспроизведённый на константе, которую
# добавил тот же пак: РАЗБОР ЧУЖОГО ЯЗЫКА РЕГУЛЯРКОЙ ЧИТАЕТ ПРОЗУ КАК ОБЪЯВЛЕНИЕ.
provider_hosts="$(parse_RF_ALLOWED_PROVIDER_HOSTS)"
[ -n "$provider_hosts" ] || { echo "::error::could not parse RF_ALLOWED_PROVIDER_HOSTS from $env_validation"; exit 2; }
echo "RF outbound provider hosts: $(echo "$provider_hosts" | tr '\n' ' ')"

src_root="backend/src"
door="$src_root/lib/providers/http.util.ts"
# ЯКОРЬ ОСИ 6 — ФАЙЛ ДВЕРИ, НЕ НАЛИЧИЕ КАТАЛОГА. Прежнее `if [ -d lib/providers ]` было FAIL-OPEN:
# переименуй каталог адаптеров — весь блок молча пропускался, а гейт печатал «passed» rc=0 (замерено
# спецом 14.08.2026: `lib/dvernaya` с адаптером на evil.example.com дал зелёное). Теперь: ось 6 обязана
# прогнаться, если дерево `backend/src` присутствует; «стенд без адаптеров» объявляется ЯВНЫМ флагом
# `RF_GATE_EXPECT_ADAPTERS=0`, а не выводится из наличия каталога. И считаем число ПРОГНАННЫХ замков —
# «сколько прошло» отличает «чисто» от «ничего не проверено» (класс «свод печатает OK, прогнав ноль»).
skipped=""
expect_adapters="${RF_GATE_EXPECT_ADAPTERS:-1}"
if [ "$expect_adapters" = 0 ]; then
  echo "  skip axis-6: стенд ОБЪЯВЛЕН без адаптеров (RF_GATE_EXPECT_ADAPTERS=0) — исходящий периметр здесь не проверяется"
  skipped="${skipped}ось-6 (исходящий периметр) "
elif [ ! -d "$src_root" ]; then
  echo "::error::$src_root отсутствует, а RF_GATE_EXPECT_ADAPTERS≠0 — исходящий периметр не проверить. Это НЕ «чисто», это «не знаю»"; fail=1
else
  locks=0
  if [ ! -f "$door" ]; then
    # Дверь по КАНОНИЧЕСКОМУ пути. Нет её здесь = снята или каталог переименован → громкий отказ,
    # а не тихий пропуск. Ровно та дыра, что сделала ось fail-open.
    echo "::error::единственная дверь периметра $door НЕ НАЙДЕНА (снята или каталог переименован) — ось 6 держать не может"; fail=1
  else
    # 6a. ОБЪЯВЛЕНИЯ адресов покрыты перечнем. Кавычки — ЛЮБЫЕ (' " `): prettier не запрещает бэктик,
    #     и адрес в двойных/шаблонных кавычках прошёл бы мимо (замерено). Предел прежний и назван:
    #     сканируются ОБЪЯВЛЕНИЯ …ENDPOINT/URL/BASE, не любой литерал (иначе ложные на комментариях/тестах).
    locks=$((locks+1))
    # USERINFO СНИМАЕТСЯ, КАК В ОСЯХ 3 И 4. Шаблон брал класс [A-Za-z0-9._-]+ и ОСТАНАВЛИВАЛСЯ на @,
    # выдавая за хост пользовательскую часть: объявление https://sms.ru@evil.example.com/steal давало
    # «ok outbound endpoint sms.ru», rc=0 (замерено кругом 3). Дверь такой адрес отказывает, то есть
    # периметр не открыт — но гейт УТВЕРЖДАЛ имя доверенного вендора там, где адрес ведёт к чужому.
    decl_hosts="$(grep -rhoE "(const|let|var)[[:space:]]+[A-Za-z0-9_]*(ENDPOINT|URL|BASE)[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*['\"\`]https?://(\\[[0-9A-Fa-f:]+\\]|[A-Za-z0-9._@:-]+)" "$src_root" --include='*.ts' 2>/dev/null \
                  | sed -E "s#.*https?://##" | sed -E 's#^[^/@]*@##' \
                  | sed -E 's#^(\[[0-9A-Fa-f:]+\]).*$#\1#; t; s#[:/].*$##' | sort -u || true)"
    if [ -z "$decl_hosts" ]; then
      echo "::error::ни одного ОБЪЯВЛЕНИЯ исходящего адреса не найдено при ЖИВОЙ двери — шаблон устарел или адаптеры переписаны. Это НЕ «чисто», это «не знаю»"; fail=1
    fi
    while IFS= read -r h; do
      [ -n "$h" ] || continue
      if echo "$provider_hosts" | grep -qxF "$h"; then
        echo "  ok   outbound endpoint $h (в RF_ALLOWED_PROVIDER_HOSTS)"
      elif host_resident_ok "$h" "" nosuffix 2>/dev/null; then
        echo "  ok   outbound endpoint $h (заведомо своё: loopback/RFC1918/односегментное)"
      else
        echo "::error::объявленный в коде исходящий адрес '$h' НЕ в RF_ALLOWED_PROVIDER_HOSTS — зашитые в код хосты гейт не видит, поэтому провайдер добавляется в константу код-ревью, иначе адрес уедет незамеченным"
        fail=1
      fi
    done <<< "$decl_hosts"

    # 6b. ОДНА ДВЕРЬ. Перечень чужих клиентов расширен на node:http(s)/http2/ws/nodemailer (сырой
    #     `request()` мимо шва). Шаблон fetch БОЛЬШЕ НЕ исключает точку — `globalThis.fetch(` и алиас
    #     `const go=fetch; go(` прошли бы мимо анти-точечного `[^.]fetch\(` (замерено). Легитимных
    #     `.fetch(` в backend/src нет ни одного (проверено). ОСТАТОК НАЗВАН: сырой `net`/`tls` не
    #     сканируем модульным импортом — `node:net` законно используется в client-ip.ts ради `isIP`
    #     (чистая проверка, не сокет); их сырой bypass — ниже вероятностью, назван долгом.
    #     ПАКЕТЫ С ОБЛАСТЬЮ ИМЁН ДОБАВЛЕНЫ 25.08.2026 ПО НАХОДКЕ №122 КРУГА 5, и это была не
    #     теоретическая дыра. ЗАМЕР (стенд из четырёх файлов, шаблон прогнан дословно): `node:https`
    #     ПОЙМАН — красный полюс есть, ось жива, — а `@sentry/node`, `@aws-sdk/client-s3` и
    #     `@opentelemetry/exporter-trace-otlp-http` не пойман НИ ОДИН: перечень состоял из ГОЛЫХ
    #     имён модулей, а почти все сегодняшние SDK со своим транспортом поставляются под областью.
    #     В ЖИВОМ дереве такой клиент уже был: lib/observability/sentry.ts импортирует @sentry/node,
    #     чей транспорт зовёт https.request мимо fetchJson и мимо assertOutboundHostAllowed, — а ось
    #     печатала «единственный исходящий клиент». Утверждение было ШИРЕ замера.
    locks=$((locks+1))
    # ═══ РЕЕСТР ВТОРЫХ ДВЕРЕЙ — ДВУСТОРОННИЙ, А НЕ СПИСОК ПРОЩЁННЫХ.
    # Прощать молча нельзя (тогда ось снова врёт), запрещать нельзя (телеметрия — законная
    # способность, закон храповика). Поэтому вторая дверь ОБЪЯВЛЯЕТСЯ здесь поимённо, с модулем и
    # с указанием, ЧЕМ её хост проверяется, — и вердикт её НАЗЫВАЕТ вслух.
    # ВТОРАЯ СТОРОНА (иначе перечень протухнет молча — закон, вынесенный из реестра расхождений
    # seed-parity): каждая запись ОБЯЗАНА быть найдена в дереве и обязана всё ещё нести свой модуль.
    # Запись, прощающая несуществующий файл, завтра простит ЧУЖОЙ файл на его месте.
    # Формат: путь|модуль|чем проверяется хост
    SECOND_DOORS=(
      "$src_root/lib/observability/sentry.ts|@sentry/node|хост ingest проверяет checkTelemetryDsn (env.validation.ts, ADR-0017 п.6); SENTRY_DSN пуст по умолчанию. СТРОГОСТЬ У ЭТОЙ ДВЕРИ СЛАБЕЕ, чем у двери провайдеров (она допускает любой РФ-суффикс) — назван долг, не покрытие"
    )
    reg_missing=""; reg_named=""
    for entry in "${SECOND_DOORS[@]}"; do
      dpath="${entry%%|*}"; drest="${entry#*|}"; dmod="${drest%%|*}"
      if [ -f "$dpath" ] && grep -qF "$dmod" "$dpath" 2>/dev/null; then
        reg_named="${reg_named}${dpath} ($dmod) "
      else
        reg_missing="$reg_missing $dpath ($dmod)"
      fi
    done
    if [ -n "$reg_missing" ]; then
      echo "::error::реестр вторых дверей ПРОТУХ — объявлено, но в дереве не найдено (или сменился модуль):$reg_missing. Запись, прощающая несуществующий файл, завтра простит чужой файл на его месте — снимите её или почините путь"; fail=1
    fi
    net_bare="axios|undici|got|node-fetch|node:http|node:https|node:http2|http|https|http2|ws|nodemailer|superagent|request|needle|phin|ky"
    net_scoped="@(sentry|aws-sdk|smithy|azure|google-cloud|opentelemetry|grpc|elastic|slack|supabase|octokit)/[A-Za-z0-9._-]+"
    net_re="from ['\"](${net_bare}|${net_scoped})['\"]|require\(['\"](${net_bare}|${net_scoped})['\"]\)"
    others_all="$(grep -rlE "$net_re" "$src_root" --include='*.ts' 2>/dev/null | grep -v '\.spec\.ts' || true)"
    others=""
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      case " $(for e in "${SECOND_DOORS[@]}"; do printf '%s ' "${e%%|*}"; done)" in
        *" $f "*) continue ;;
      esac
      others="${others}${f}"$'\n'
    done <<< "$others_all"
    others="$(printf '%s' "$others" | sed '/^$/d')"
    if [ -n "$others" ]; then
      echo "::error::сетевой клиент ВНЕ единственного шва и ВНЕ реестра вторых дверей: $(echo "$others" | tr '\n' ' ')"; fail=1
    fi
    direct="$(grep -rlE "\bfetch[[:space:]]*\(|(globalThis|global|window)\.fetch[[:space:]]*\(" "$src_root" --include='*.ts' 2>/dev/null | grep -v "lib/providers/http.util.ts" | grep -v '\.spec\.ts' || true)"
    if [ -n "$direct" ]; then
      echo "::error::прямой fetch() вне lib/providers/http.util.ts — периметр перестаёт быть виден в одном месте: $(echo "$direct" | tr '\n' ' ')"; fail=1
    else
      # ВЕРДИКТ НЕ ШИРЕ ЗАМЕРА (наш собственный класс): «одна дверь» верно про ЗАПРОСЫ ПРОВАЙДЕРОВ,
      # а вторые двери называются поимённо, а не замалчиваются словом «единственный».
      echo "  ok   одна дверь ДЛЯ ЗАПРОСОВ ПРОВАЙДЕРОВ: lib/providers/http.util.ts${reg_named:+; вторые двери ПО РЕЕСТРУ (не мимо гейта, а названы): $reg_named}"
    fi

    # 6c. ЗАМОК В ДВЕРИ. Наличие строки вызова ловится лишь в одной форме (вызов есть, а
    #     isAllowedProviderHost обезврежен → зелёно); ПОВЕДЕНИЕ проверяет юнит-свод `http.util.spec`,
    #     который идёт в CI job `unit` рядом с этим гейтом — он и есть несущий свидетель. Здесь —
    #     дешёвая страховка на снятие вызова.
    locks=$((locks+1))
    if grep -q 'assertOutboundHostAllowed(provider, url)' "$door" 2>/dev/null; then
      echo "  ok   дверь зовёт assertOutboundHostAllowed ДО запроса (поведение — http.util.spec, шаг CI unit)"
    else
      echo "::error::$door больше не зовёт assertOutboundHostAllowed перед fetch — проверка периметра снята"; fail=1
    fi
  fi
  # ЧИСЛО ПРОГНАННЫХ СВЕРЯЕТСЯ С ОЖИДАЕМЫМ, А НЕ ПРОСТО ПЕЧАТАЕТСЯ (находка круга 1; ADR-0027:
  # «фактическое рядом с ОЖИДАЕМЫМ»). Печаталось «прогнано замков 0» при снятой двери — и это
  # молча уезжало в зелёный вердикт: упасть по числу было НЕЛЬЗЯ.
  echo "  axis-6: прогнано замков $locks из ожидаемых 3 (6a объявления + 6b одна-дверь + 6c вызов); дверь=$([ -f "$door" ] && echo есть || echo НЕТ)"
  if [ "$locks" -ne 3 ]; then
    echo "::error::ось 6 прогнала $locks замков из 3 — это НЕ «чисто», это НЕ ЗНАЮ"; fail=1
  fi
fi

# (7) ПОСЛАБЛЕНИЕ СТЕНДОВ НЕ СМЕЕТ ЖИТЬ В БОЕВОЙ КОНФИГУРАЦИИ (решение держателя 17.08.2026).
#     Дверь пускает односегментные имена (`mock-sms`, `minio`) только при явном
#     ALLOW_LOCAL_STAND_HOSTS — это сохранённая способность стендов (закон храповика), но в бою она
#     означала бы, что разрешение имени отдано resolv.conf МАШИНЫ (находка №9). Пока флаг проверялся
#     только кодом, «в проде послабление выключено» было ОБЕЩАНИЕМ. Здесь оно становится ОСЬЮ.
#     Замечание о полноте: гейт видит объявленную топологию (.env.example, compose, Caddyfile), а не
#     развёрнутый .env оператора — это назван предел, а не покрытие (находка ре-гейта про gen-env.sh).
stand_flag_hits=0
# Словари тумблера — из источника, разово (находка №176). Пустой разбор = НЕ ЗНАЮ, а не «нет
# запретов»: молчащий словарь сделал бы ось всепрощающей ровно там, где она обязана быть строгой.
toggle_on_words="$(parse_STAND_HOSTS_TOGGLE_ON)"
toggle_off_words="$(parse_STAND_HOSTS_TOGGLE_OFF)"
toggle_dict_ok=1
if [ -z "$toggle_on_words" ] || [ -z "$toggle_off_words" ]; then
  echo "::error::не удалось разобрать словарь ALLOW_LOCAL_STAND_HOSTS из $env_validation (ВКЛ:«$toggle_on_words» ВЫКЛ:«$toggle_off_words») — ось 7 отказывается судить вслепую (fail-closed)"
  fail=1
  toggle_dict_ok=0
fi
# Сканируем НЕ ТОЛЬКО объявленную топологию: боевое окружение приходит из .env (docker-compose
# отдаёт его сервисам через env_file), а пишет .env — deploy/gen-env.sh. Ось, смотрящая только в
# .env.example, печатала «найдено 0» и ЧИТАЛАСЬ КАК ПОКРЫТИЕ, не покрывая единственное место, куда
# флаг и вписывают (найдено безопасником, круг 2).
stand_scan=("${files[@]}")
for extra in .env deploy/gen-env.sh; do
  [ -f "$extra" ] && stand_scan+=("$extra")
done
# ПОСЛЕ ОТКАЗА СЛОВАРЯ ЦИКЛ НЕ СУДИТ ВОВСЕ (не-блокер держателя по ревью №176, 31.08.2026).
# Вердикт был верен и без этого — fail=1 уже стоит, — но цикл продолжал печатать косметические
# «ok … ВЫКЛЮЧЕНО явно» пустыми словарями рядом с уже красным вердиктом. Строка «ok», выданная
# прибором, который признал, что судить не может, — это ложный шум в честном отказе, и читатель
# журнала берёт её за свидетельство. Молчим о том, чего не знаем.
for f in "${stand_scan[@]}"; do
  [ "$toggle_dict_ok" = 1 ] || break
  while IFS= read -r line; do
    # СНАЧАЛА ОТРЕЗАЕМ «НОМЕР:» ОТ grep -n, ПОТОМ смотрим, комментарий ли это. Без этого проверка
    # видела строку целиком («107:# ALLOW_…») и комментарий НИКОГДА не распознавался — ось выносила
    # ЛОЖНОЕ обвинение на закомментированной строке и тем блокировала единственный правильный способ
    # закрыть контрактную дыру: задокументировать флаг. Замерено reviewer-qa на круге 2. Пять
    # соседних циклов этого файла делают правильно; этот — не делал.
    body="${line#*:}"
    case "$(echo "$body" | sed 's/^[[:space:]]*//')" in \#*) continue ;; esac
    # ═══ СУДИМ ЗНАЧЕНИЕ, А НЕ ФАКТ ОБЪЯВЛЕНИЯ (находка №176) ═══
    # Ось считала вхождением ЛЮБУЮ незакомментированную строку с этим именем — и обвиняла
    # `ALLOW_LOCAL_STAND_HOSTS=0`, то есть СТРОГИЙ режим, заявленный ЯВНО. Гейт стал красен
    # навсегда: схема ОТВЕРГАЕТ пустое flag_line тумблера (находка №172), а шаблон обязан стартовать
    # дословно (№148/№157) — значит строка обязана быть, и обязана нести `0`. Два верных лечения
    # делали зелёное недостижимым, и вместе с гейтом ослепла его самопроверка (6 мутантов из 23
    # ждали зелёного и получали постоянный отказ).
    # Способность, которую ось стережёт, — это ПОСЛАБЛЕНИЕ ВКЛЮЧЕНО, а не «имя встретилось».
    # Словарь берётся из ЕДИНСТВЕННОГО источника (env.validation.ts), а не списывается сюда.
    # ⚠️ ИМЕНА ПЕРЕМЕННЫХ — ЛАТИНИЦЕЙ. Первая редакция этой оси была написана кириллическими
    # именами, и bash их НЕ ПРИСВАИВАЕТ: прогон дал «$'toggle_on_words=1\ntrue\nyes': command not
    # found», rc=127 на ИСПРАВНОЙ логике. Ровно тот класс, что записан треком 28.08 («прибор,
    # который не смог посмотреть, всё равно судит»), и записан он был в ЭТОМ ЖЕ файле. Знание
    # класса не защищает от класса — защищает ПРОГОН.
    flag_line="$(printf '%s' "$body" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    flag_form="прочее"
    case "$flag_line" in
      # Форма БЕЗ знака равенства («- ALLOW_LOCAL_STAND_HOSTS» в compose, `export ALLOW_…`) — это
      # СКВОЗНАЯ ПЕРЕДАЧА значения из окружения хоста: чему оно равно, мы не знаем, а «не знаю» —
      # не «выключено». Остаётся красным.
      *ALLOW_LOCAL_STAND_HOSTS=*) flag_form="со-flag_lineм" ;;
      *) flag_form="сквозная" ;;
    esac
    if [ "$flag_form" = "со-flag_lineм" ]; then
      # Разбор ТОТ ЖЕ, что у двери (env.validation.ts::normalizeStandHostsToggle): trim + нижний
      # регистр. Кавычки снимаем — .env и compose пишут и `X=0`, и `X="0"`.
      v="${flag_line#*ALLOW_LOCAL_STAND_HOSTS=}"
      v="$(printf '%s' "$v" | sed 's/[[:space:]].*$//; s/^["'"'"']//; s/["'"'"']$//' | tr 'A-Z' 'a-z')"
      if printf '%s\n' "$toggle_off_words" | grep -qxF -- "$v"; then
        echo "  ok   $f: ALLOW_LOCAL_STAND_HOSTS=$v — послабление ВЫКЛЮЧЕНО явно (словарь ВЫКЛ из env.validation.ts)"
        continue # зелёный полюс 176
      fi
      if printf '%s\n' "$toggle_on_words" | grep -qxF -- "$v"; then
        why_red="ВКЛЮЧЕНО (flag_line «$v» из словаря ВКЛ)"
      else
        # НЕИЗВЕСТНОЕ ЗНАЧЕНИЕ — НЕ «ВЫКЛЮЧЕНО». Схема такое отвергает на старте, но гейт читает
        # ТЕКСТ топологии, а не запущенный процесс: молчать здесь значило бы пускать опечатку.
        why_red="flag_line «$v» НЕ ИЗ СЛОВАРЯ — неизвестное не равно выключенному"
      fi
    else
      why_red="сквозная передача БЕЗ значения — оно приходит из окружения хоста и нам неизвестно"
    fi
    stand_flag_hits=$((stand_flag_hits+1))
    echo "::error::$f: послабление стендов в боевой топологии — $why_red: односегментные имена разрешались бы resolv.conf машины, а не нашим перечнем (находка №9)"
    fail=1
  done < <(grep -n 'ALLOW_LOCAL_STAND_HOSTS' "$f" 2>/dev/null || true)
done
echo "  axis-7: послабление стендов в боевой топологии — найдено ВКЛЮЧЁННЫХ/неизвестных: $stand_flag_hits (ожидается 0)"


if [ "$fail" -ne 0 ]; then
  echo "::error::RF data-residency gate FAILED — prod config points a PII-bearing store, sink or CDN outside the RF (ADR-0017)."
  exit 1
fi
# ВЕРДИКТ НЕ СМЕЕТ БЫТЬ ШИРЕ ПРОГНАННОГО (находка круга 1). Прежде при объявленном пропуске оси 6
# печаталась та же безусловная строка «every … value is RF-resident» — то есть утверждение о мире
# оставалось прежним, хотя проверено было меньше. Пропуск ЗАКОННЫЙ (его объявляет вызывающий), но
# молчать о нём в итоге нельзя: третье состояние — «чисто В ПРОВЕРЕННОМ, об остальном НЕ ЗНАЮ».
if [ -n "$skipped" ]; then
  echo "✅ RF data-residency gate passed В ПРОВЕРЕННОМ — но ПРОПУЩЕНО по объявлению: ${skipped}⇒ об этом гейт НЕ ЗНАЕТ, вердикт уже своего имени."
  exit 0
fi
echo "✅ RF data-residency gate passed — every region- and host-bearing prod config value is RF-resident."
