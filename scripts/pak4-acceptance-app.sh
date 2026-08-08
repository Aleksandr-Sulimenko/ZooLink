#!/usr/bin/env bash
# ============================================================================================
# ACCEPTANCE (прикладная половина) — оси Г-М2 (счётчик в выводе провижининга) и Г-М3 (ветвь 2
# со стороны приложения: touch-семантика / ETag / P2025). Дополняет acceptance.sh (SQL-половина).
#
# Гоняет НАСТОЯЩИЙ provision.ts и НАСТОЯЩИЙ Prisma-клиент против ЭФЕМЕРНОЙ БД (контейнер
# zl-pak4-app, порт 55433, удаляет себя за собой). Живой стенд не трогается.
#
# Работает В ДВУХ РЕЖИМАХ:
#   · пак ЕЩЁ НЕ вкачен (черновик в скретчпаде) → собирает оверлей из симлинков на репозиторий
#     + пропатченные файлы из этого каталога, репозиторий не меняется;
#   · пак УЖЕ вкачен (в provision.ts есть 'ZL042') → гоняет прямо из репозитория.
#
# Запуск:  bash acceptance-app.sh [/путь/к/ZooLink]
# ============================================================================================
set -uo pipefail
REPO="${1:-/home/asulimenko/Project/workspace/ZooLink}"
HERE="$(cd "$(dirname "$0")" && pwd)"
C=zl-pak4-app
PORT=55433
URL_BASE="postgres://postgres@127.0.0.1:${PORT}"
NM="$REPO/backend/node_modules"
FAILED=0
pass() { echo "  ✅ PASS  $1"; }
fail() { echo "  ❌ FAIL  $1"; FAILED=1; }
psqlq() { docker exec $C psql -U postgres -d "$1" -X -A -t -v ON_ERROR_STOP=1 -c "$2" 2>&1; }

cleanup() { docker rm -f $C >/dev/null 2>&1 || true; rm -rf "$HERE/.appmirror" "$HERE/.appmig"; }
trap cleanup EXIT

# ── что запускаем: репозиторий как есть, или оверлей с черновиком ───────────────────────────
if grep -q "ZL042" "$REPO/backend/src/provision.ts" 2>/dev/null; then
  MODE="repo"; SRC_ROOT="$REPO/backend"; MIGDIR="$REPO/migrations"; CANON="$REPO/database_schema.sql"
else
  MODE="overlay"
  rm -rf "$HERE/.appmirror" "$HERE/.appmig"; mkdir -p "$HERE/.appmirror/src" "$HERE/.appmig"
  ln -s "$NM" "$HERE/.appmirror/node_modules"
  for f in tsconfig.json package.json; do ln -s "$REPO/backend/$f" "$HERE/.appmirror/$f"; done
  for e in $(ls "$REPO/backend/src"); do
    [ "$e" = "provision.ts" ] || ln -s "$REPO/backend/src/$e" "$HERE/.appmirror/src/$e"
  done
  cp "$HERE/work/provision.ts" "$HERE/.appmirror/src/provision.ts"
  cp "$REPO/migrations/"*.sql "$HERE/.appmig/"
  cp "$HERE/20260808_0042_species_market_replay_guard.sql" "$HERE/.appmig/"
  SRC_ROOT="$HERE/.appmirror"; MIGDIR="$HERE/.appmig"; CANON="$REPO/database_schema.sql"
fi
echo "── режим: $MODE · миграций: $(ls "$MIGDIR"/*.sql | wc -l) ─────────────────────────────"

docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -p ${PORT}:5432 -e POSTGRES_PASSWORD=pg -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for _ in $(seq 1 40); do docker exec $C pg_isready -U postgres -q && break; sleep 1; done

provision() { # $1 = db name → печатает вывод провижининга
  ( cd "$SRC_ROOT" && DATABASE_URL="$URL_BASE/$1" SCHEMA_FILE="$CANON" MIGRATIONS_DIR="$MIGDIR" \
      timeout 600 "$NM/.bin/ts-node" --project "$REPO/backend/tsconfig.json" src/provision.ts 2>&1 )
}
counter_line() { echo "$1" | grep -E "operator decisions preserved" | tail -1; }

echo
echo "── Г-М2 сценарий B: ЧИСТАЯ установка → строка ПРИСУТСТВУЕТ и равна 0 ───────────────────"
docker exec $C psql -U postgres -q -c "CREATE DATABASE clean" >/dev/null 2>&1
outB=$(provision clean); lineB=$(counter_line "$outB")
[ -n "$lineB" ] && pass "строка есть на чистой установке: «$(echo "$lineB" | sed 's/^ *//')»" \
                || fail "строки НЕТ — отсутствие неотличимо от «забыли напечатать»"
echo "$lineB" | grep -qE ": 0$" && pass "значение = 0" || fail "значение не 0: $lineB"
sp=$(psqlq clean "SELECT string_agg(code||'='||market,',' ORDER BY id) FROM species")
[ "$sp" = "dog=pet,cat=pet,cattle=livestock,sheep=livestock,horse=livestock" ] \
  && pass "сид не сломан заслонкой: $sp" || fail "сид сломан: $sp"

echo
echo "── Г-М2 сценарий A: решение оператора существует → строка = 1, значение сохранено ──────"
psqlq clean "INSERT INTO users (id, full_name, role) VALUES ('11111111-1111-1111-1111-111111111111','Admin One','ADMIN') ON CONFLICT DO NOTHING" >/dev/null
psqlq clean "BEGIN; SELECT set_config('app.reference_data_admin','on',true); UPDATE species SET market='pet', updated_by='11111111-1111-1111-1111-111111111111' WHERE code='cattle'; COMMIT;" >/dev/null
outA=$(provision clean); lineA=$(counter_line "$outA")
echo "$lineA" | grep -qE ": 1$" && pass "значение = 1 («$(echo "$lineA" | sed 's/^ *//')»)" || fail "ожидали 1, получили: $lineA"
[ "$(psqlq clean "SELECT market FROM species WHERE code='cattle'")" = "pet" ] \
  && pass "и само решение сохранено (cattle=pet)" || fail "решение затёрто"

echo
echo "── Г-М2 контроль: второй прогон подряд → снова 0/1 без роста, фоссилия неподвижна ──────"
S1=$(psqlq clean "SELECT string_agg(code||':'||market||':'||xmin,'|' ORDER BY id) FROM species")
out2=$(provision clean); S2=$(psqlq clean "SELECT string_agg(code||':'||market||':'||xmin,'|' ORDER BY id) FROM species")
[ "$S1" = "$S2" ] && pass "xmin/значения идентичны после ВТОРОГО настоящего прогона провижининга" \
                  || { fail "строки двигаются"; echo "     $S1"; echo "     $S2"; }
counter_line "$out2" | grep -qE ": 1$" && pass "счётчик стабилен (1 на прогон, не накапливается)" \
                                       || fail "счётчик нестабилен: $(counter_line "$out2")"

echo
echo "── Г-М3: ветвь 2 со стороны приложения (живой Prisma) ─────────────────────────────────"
gm3=$(cd "$REPO/backend" && NODE_PATH="$NM" DB_URL="$URL_BASE/clean" node "$HERE/measure-prisma-axis.js" 2>&1)
echo "$gm3" | sed 's/^/     /'
echo "$gm3" | grep -q "AXIS-1 OK" && pass "PATCH-эквивалент с ИДЕНТИЧНЫМ телом при поднятой заслонке: успех + updated_at сдвинулся (touch/ETag сохранены)" \
                                  || fail "прикладной путь сломан ветвью 2"
echo "$gm3" | grep -q "AXIS-2 OK" && pass "ветвь 2 недостижима вне отпечатка 0007: чужой no-op проходит, P2025 не возникает" \
                                  || fail "чужой no-op попал в ветвь 2 (риск P2025→500)"

echo
[ "$FAILED" = "0" ] && echo "ИТОГ: ВСЕ ПРИКЛАДНЫЕ ОСИ ЗЕЛЁНЫЕ" || echo "ИТОГ: ЕСТЬ КРАСНОЕ"
exit "$FAILED"
