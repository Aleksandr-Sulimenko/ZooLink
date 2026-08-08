#!/usr/bin/env bash
# ============================================================================================
# ACCEPTANCE (пак-4, миграция 0042 «заслонка species.market»). Оси (а),(б),(г),(д),(е) + красный-до.
# Ось (в) — прикладной путь — здесь НЕ проверяется: у неё есть исполняемые команды в ACCEPTANCE.md
# (unit-спека + e2e + curl по живому стенду), потому что она про КОД, а не про SQL.
#
# ПОЛНОСТЬЮ ЭФЕМЕРНО: свой контейнер zl-pak4-acc, свои БД, удаляет себя за собой.
# ЖИВОЙ СТЕНД (zoolink-postgres-1 / compose) НЕ ТРОГАЕТСЯ ни на чтение схемы, ни на запись.
# Из репозитория только ЧИТАЕТ (database_schema.sql, migrations/*).
#
# Запуск:  bash acceptance.sh [/путь/к/репозиторию/ZooLink]
# Выход:   0 = все оси зелёные; 1 = хотя бы одна красная (печатает какая).
# ============================================================================================
set -uo pipefail
REPO="${1:-/home/asulimenko/Project/workspace/ZooLink}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/20260808_0042_species_market_replay_guard.sql"
C=zl-pak4-acc
FAILED=0

pass() { echo "  ✅ PASS  $1"; }
fail() { echo "  ❌ FAIL  $1"; FAILED=1; }
q()    { docker exec "$C" psql -U postgres -d "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "$2" 2>&1; }
qraw() { docker exec "$C" psql -U postgres -d "$1" -X -v ON_ERROR_STOP=1 -c "$2" 2>&1; }
# НЕ глушим ошибку насмерть: молчащий apply однажды дал «replay failed on 0001», хотя настоящей
# причиной был неудавшийся ДО него канон (гонка готовности сервера). Ошибку показываем, код возвращаем.
apply(){
  local out
  out=$(docker exec "$C" psql -U postgres -d "$1" -q -v ON_ERROR_STOP=1 -f "$2" 2>&1)
  if echo "$out" | grep -q "^psql.*ERROR\|^ERROR"; then
    echo "     [apply $2 → $1] $(echo "$out" | grep -m2 "ERROR")"
    return 1
  fi
  return 0
}

# Готовность: образ postgres поднимает ВРЕМЕННЫЙ сервер на время initdb — pg_isready на нём уже
# отвечает, после чего сервер ПЕРЕЗАПУСКАЕТСЯ, и следующая команда падает. Поэтому ждём сначала
# завершения инициализации по логу, и только затем — реального ответа на запрос.
wait_ready(){
  for _ in $(seq 1 60); do
    docker logs "$C" 2>&1 | grep -q "init process complete" && break; sleep 1
  done
  for _ in $(seq 1 60); do
    docker exec "$C" psql -U postgres -X -q -c 'SELECT 1' >/dev/null 2>&1 && return 0; sleep 1
  done
  echo "postgres не поднялся"; return 1
}
sig()  { q "$1" "SELECT string_agg(code||':'||market||':'||updated_at||':'||xmin,'|' ORDER BY id) FROM species"; }

replay() { # replay every migration in filename order; $2='with42' also applies 0042 at the end
  for f in $(docker exec "$C" sh -c 'ls /tmp/migrations/*.sql | sort'); do
    apply "$1" "$f" || { echo "replay failed on $f"; return 1; }
  done
  [ "${2:-}" = "with42" ] && apply "$1" /tmp/0042.sql
  return 0
}

cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "── ephemeral PG 16 (${C}) ───────────────────────────────────────────────"
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" -e POSTGRES_PASSWORD=pg -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
wait_ready || exit 1
# КРАСНЫЙ-ДО обязан строиться из PRE-FIX артефакта, а не из дерева. После вкатки зеркала канон в
# дереве УЖЕ несёт заслонку, поэтому «старая форма», собранная из него, перестаёт затирать — и ось
# честно сообщала «красный-до не воспроизвёлся» (не ложно-зеленела, но и свидетелем быть перестала).
# Берём канон и миграции ДО вкатки из git (тем же приёмом, что pre-fix provision.ts берётся по SHA).
PREFIX_REF="${PREFIX_REF:-0b3662f}"   # последний коммит ПЕРЕД Паком 4
git -C "$REPO" show "$PREFIX_REF:database_schema.sql" > /tmp/canon-prefix.sql 2>/dev/null \
  || { echo "::error::не удалось взять канон из $PREFIX_REF — красный-до недоказуем, ОСТАНОВКА"; exit 2; }
grep -q "trg_species_market_replay_guard" /tmp/canon-prefix.sql \
  && { echo "::error::канон из $PREFIX_REF УЖЕ содержит заслонку — выбран не тот ref, ОСТАНОВКА"; exit 2; }
docker cp /tmp/canon-prefix.sql "$C:/tmp/canon-old.sql" >/dev/null
docker cp "$REPO/database_schema.sql" "$C:/tmp/canon.sql" >/dev/null
docker cp "$REPO/migrations" "$C:/tmp/migrations" >/dev/null
docker cp "$MIG" "$C:/tmp/0042.sql" >/dev/null
# 0042 теперь ЖИВЁТ в migrations/ дерева (вкачен), поэтому обычный replay притащил бы заслонку и в
# «старую форму» — красный-до опять стал бы недоказуем. Убираем её из общего набора: old = 41 файл,
# new = 41 + 0042 отдельно (ровно исходный замысел скрипта, сломанный самим фактом вкатки).
docker exec "$C" sh -c 'rm -f /tmp/migrations/*0042*' >/dev/null
docker exec "$C" sh -c 'ls /tmp/migrations/*.sql | wc -l' | tr -d "\r" | { read n; [ "$n" = 41 ] || { echo "::error::в наборе old ожидались 41 миграция, получено $n — ОСТАНОВКА"; exit 2; }; } || exit 2

# ── ФИКСТУРА: две БД. old = сегодняшняя форма (без 0042). new = с 0042. ─────────────────────
for db in old new; do
  CANON_FOR_DB="/tmp/canon.sql"; [ "$db" = old ] && CANON_FOR_DB="/tmp/canon-old.sql"
  docker exec "$C" psql -U postgres -q -c "CREATE DATABASE $db" >/dev/null 2>&1
  apply "$db" "$CANON_FOR_DB" || { echo "канон не применился в $db — дальше мерить нечего"; exit 1; }
done
replay old        || exit 1
replay new with42 || exit 1
# Оператор (ADMIN) переводит cattle 'livestock' → 'pet' ПРИКЛАДНЫМ путём: заслонка поднята,
# updated_by проштампован (ровно то, что делает ReferenceDataService.update).
for db in old new; do
  CANON_FOR_DB="/tmp/canon.sql"; [ "$db" = old ] && CANON_FOR_DB="/tmp/canon-old.sql"
  q "$db" "INSERT INTO users (id, full_name, role) VALUES ('11111111-1111-1111-1111-111111111111','Admin One','ADMIN') ON CONFLICT DO NOTHING" >/dev/null
  q "$db" "BEGIN; SELECT set_config('app.reference_data_admin','on',true); UPDATE species SET market='pet', updated_by='11111111-1111-1111-1111-111111111111' WHERE code='cattle'; COMMIT;" >/dev/null
done

echo
echo "── (а) решение оператора переживает replay  [+ КРАСНЫЙ-ДО на старой форме] ─────────────"
replay old >/dev/null; replay new >/dev/null
before_old=$(q old "SELECT market FROM species WHERE code='cattle'")
after_new=$(q new "SELECT market FROM species WHERE code='cattle'")
[ "$before_old" = "livestock" ] && pass "красный-до: СТАРАЯ форма затирает 'pet' → '$before_old'" \
                                || fail "красный-до не воспроизвёлся (old='$before_old' — ждали livestock)"
[ "$after_new" = "pet" ] && pass "новая форма: значение оператора СОХРАНИЛОСЬ ('$after_new')" \
                         || fail "новая форма затёрла значение (new='$after_new')"
w=$(docker logs "$C" 2>&1 | grep -c "подавлен replay миграции 0007")
[ "$w" -ge 1 ] && pass "подавление НЕ бесследно: WARNING в логе сервера ($w шт.)" \
               || fail "подавление прошло без следа в логе"

echo
echo "── (б) фоссилия перестала расти: два прогона провижининга подряд ───────────────────────"
s1_old=$(sig old); replay old >/dev/null; s2_old=$(sig old)
s1_new=$(sig new); replay new >/dev/null; s2_new=$(sig new)
[ "$s1_old" != "$s2_old" ] && pass "красный-до: на СТАРОЙ форме updated_at/xmin двигаются" \
                           || fail "красный-до не воспроизвёлся (старая форма не двигает строки)"
[ "$s1_new" = "$s2_new" ] && pass "новая форма: updated_at И xmin ИДЕНТИЧНЫ (строка не перезаписана)" \
                          || { fail "фоссилия всё ещё растёт"; echo "     до:  $s1_new"; echo "     после: $s2_new"; }

echo
echo "── (г) Г-М1: прикладной путь со СНЯТОЙ заслонкой падает ГРОМКО, называя предмет ────────"
out=$(qraw new "BEGIN; UPDATE species SET market='livestock', updated_by='22222222-2222-2222-2222-222222222222' WHERE code='cattle'; ROLLBACK;")
echo "$out" | grep -q "ERROR" \
  && { echo "$out" | grep -q "species.market" && echo "$out" | grep -q "app.reference_data_admin" \
       && pass "EXCEPTION называет предмет (species.market) и заслонку" \
       || fail "упало, но текст не называет предмет/заслонку"; } \
  || fail "НЕ упало — тихое подавление живого пути (нарушение Г-М1)"
echo "$out" | grep -q "HINT" && pass "в ошибке есть HINT «что делать»" || fail "нет HINT"
# и сырая правка, НЕ совпадающая с отпечатком 0007, тоже громкая (даже по нетронутой строке).
# ВНИМАНИЕ (ловушка, поймана на себе): вывод qraw НЕЛЬЗЯ гнать в `| grep -q` — при `set -o pipefail`
# статус конвейера берётся от psql (он валится по ON_ERROR_STOP), и УСПЕШНЫЙ grep читается как провал
# ⇒ ложно-КРАСНАЯ ось. Сначала в переменную, потом grep.
out=$(qraw new "UPDATE species SET market='livestock' WHERE code='dog'")
echo "$out" | grep -q "ERROR" \
  && pass "сырая правка вне отпечатка 0007 — тоже ГРОМКО (code=dog)" \
  || fail "сырая правка вне отпечатка прошла молча"

echo
echo "── (д) заслонка не шире нужного: SET LOCAL не живёт вне своей транзакции ───────────────"
# ВНИМАНИЕ: после первого set_config(...,true) placeholder остаётся в СЕССИИ со значением '' —
# НЕ NULL. Проверять надо «≠ 'on'», а не «IS NULL» (иначе ось ложно краснеет).
v=$(q new "BEGIN; SELECT set_config('app.reference_data_admin','on',true); COMMIT; SELECT quote_literal(current_setting('app.reference_data_admin', true));" | tail -1)
[ "$v" = "''" ] && pass "после COMMIT заслонка опущена (значение $v, не 'on')" || fail "после COMMIT значение = $v"
out=$(qraw new "BEGIN; UPDATE species SET market='pet', updated_by='22222222-2222-2222-2222-222222222222' WHERE code='cattle'; ROLLBACK;")
echo "$out" | grep -q "ERROR" && pass "СЛЕДУЮЩАЯ транзакция заслонки не имеет — та же правка падает" \
                             || fail "заслонка протекла в следующую транзакцию"

echo
echo "── (е) код из списка 0007, заведённый оператором, replay НЕ переписывает ───────────────"
q new "INSERT INTO species (code, name_localized, market, created_by, updated_by) VALUES ('goat','{\"ru\":\"Коза\",\"en\":\"Goat\"}','pet','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111') ON CONFLICT (code) DO NOTHING" >/dev/null
q new "INSERT INTO species (code, name_localized, market) VALUES ('pig','{\"ru\":\"Свинья\",\"en\":\"Pig\"}','pet') ON CONFLICT (code) DO NOTHING" >/dev/null
replay new >/dev/null
g=$(q new "SELECT market FROM species WHERE code='goat'"); p=$(q new "SELECT market FROM species WHERE code='pig'")
[ "$g" = "pet" ] && pass "goat (создан прикладным путём, провенанс есть) остался '$g'" \
                 || fail "goat переписан в '$g'"
[ "$p" = "livestock" ] && pass "КОНТРОЛЬ: pig без провенанса (сырой INSERT) сид доводит до '$p' — граница именно там, где объявлена" \
                       || fail "КОНТРОЛЬ pig = '$p' (ждали livestock: у строки нет решения оператора, которое надо защищать)"

echo
echo "── идемпотентность самой 0042 (её гоняет тот же безусловный replay) ───────────────────"
apply new /tmp/0042.sql && apply new /tmp/0042.sql && pass "0042 применяется дважды без ошибки" || fail "0042 не идемпотентна"
n=$(q new "SELECT count(*) FROM pg_trigger WHERE tgname='trg_species_market_replay_guard'")
[ "$n" = "1" ] && pass "триггер существует РОВНО в одном экземпляре" || fail "экземпляров триггера: $n"

echo
[ "$FAILED" = "0" ] && echo "ИТОГ: ВСЕ ОСИ ЗЕЛЁНЫЕ" || echo "ИТОГ: ЕСТЬ КРАСНОЕ (см. ❌ выше)"
exit "$FAILED"
