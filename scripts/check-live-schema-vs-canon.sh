#!/usr/bin/env bash
#
# check-live-schema-vs-canon.sh — ОТВЕЧАЕТ НА ВОПРОС, КОТОРЫЙ НИКТО НЕ ЗАДАВАЛ ПРИБОРУ:
# та ли схема у ЖИВОГО стенда, на котором мы принимаем работу, что объявлена каноном.
#
# ЗАЧЕМ. С 07.08.2026 у трека висел долг: приёмки (в том числе четыре круга ре-гейта исходящего
# периметра) прогонялись на живой БД стенда, а её схема с каноном НЕ СВЕРЯЛАСЬ. «Всё зелёное» стояло
# на схеме, о которой мы знали только то, что она когда-то родилась из миграций. Долг закрывается не
# словом, а этим прибором — иначе ответ протухнет к следующей миграции.
#
# ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Это НЕ drift-гейт CI (тот строит БД из канона и сверяет ПРОИЗВОДНЫЙ
# schema.prisma) и НЕ db-sync-canon.sh (тот пересобирает производный артефакт ИЗ канона). Здесь
# сравниваются ДВЕ ЖИВЫЕ БАЗЫ: та, на которой мы работаем, и та, что построена из канона сейчас.
#
# ТРИ СОСТОЯНИЯ (ADR-0027), rc: 0 = СОШЛОСЬ · 1 = РАСХОЖДЕНИЕ · 2 = НЕ ЗНАЮ (стенд не поднят,
# канон не найден, зонд не собрался). «Не знаю» НИКОГДА не выдаётся за «сошлось».
set -uo pipefail

case "${1:-}" in
  ''|--подробно) ;;
  *) echo "::error::неизвестный аргумент «$1». Допустимо: без аргументов или --подробно" >&2; exit 2 ;;
esac

CONTAINER="${ZOOLINK_PG_CONTAINER:-zoolink-postgres-1}"
DBUSER="${ZOOLINK_PG_USER:-zoolink}"
LIVE="${ZOOLINK_PG_DB:-zoolink}"
PROBE=zoolink_canon_probe_$$
CANON="$(git rev-parse --show-toplevel 2>/dev/null)/database_schema.sql"

nz(){ echo "::error::НЕ ЗНАЮ — $1"; exit 2; }

[ -f "$CANON" ] || nz "канон $CANON не найден"
docker exec "$CONTAINER" pg_isready -U "$DBUSER" >/dev/null 2>&1 || nz "контейнер $CONTAINER не отвечает (стенд не поднят?)"

work="$(mktemp -d)"; trap 'rm -rf "$work"; docker exec "$CONTAINER" psql -U "$DBUSER" -d postgres -qc "DROP DATABASE IF EXISTS $PROBE;" >/dev/null 2>&1' EXIT

docker exec "$CONTAINER" psql -U "$DBUSER" -d postgres -qc "CREATE DATABASE $PROBE;" >/dev/null 2>&1 || nz "не удалось создать зонд-БД"
docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$PROBE" -v ON_ERROR_STOP=1 -q < "$CANON" >/dev/null 2>&1 || nz "канон не применился к чистой БД — это отдельная беда, и она хуже расхождения"

# НОРМАЛИЗАЦИЯ НАЗВАНА ЯВНО, ЧТОБЫ НИКТО НЕ СЧЁЛ ЕЁ «ПРОСТО ФОРМАТИРОВАНИЕМ»: снимаются комментарии
# (в т.ч. ВНУТРИ тел функций), пустые строки, SET-преамбула и токены \restrict свежего pg_dump.
# Комментарии снимаются СОЗНАТЕЛЬНО: расхождение в тексте diff_commentентария — не расхождение схемы, но оно
# ПЕЧАТАЕТСЯ отдельной строкой ниже, а не исчезает молча.
дамп(){ docker exec "$CONTAINER" pg_dump -U "$DBUSER" -d "$1" --schema-only --no-owner --no-privileges 2>/dev/null; }
норм(){ grep -vE "^\s*--|^$|^SET |^SELECT pg_catalog|^\\\\(un)?restrict"; }

дамп "$LIVE"  > "$work/live.raw"  || nz "не снялся дамп живой БД"
дамп "$PROBE" > "$work/canon.raw" || nz "не снялся дамп зонд-БД"
[ -s "$work/live.raw" ] && [ -s "$work/canon.raw" ] || nz "дамп пуст — сравнивать нечего"

норм < "$work/live.raw"  | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//' | sort > "$work/live.n"
норм < "$work/canon.raw" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//' | sort > "$work/canon.n"

counts(){ docker exec "$CONTAINER" psql -U "$DBUSER" -d "$1" -tAc "select (select count(*) from information_schema.tables where table_schema='public')||'/'||(select count(*) from pg_indexes where schemaname='public')||'/'||(select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public')||'/'||(select count(*) from information_schema.columns where table_schema='public')"; }
# ИМЕНА ПЕРЕМЕННЫХ — ТОЛЬКО ASCII, И ЭТО НЕ ВКУСОВЩИНА (замерено при написании этого прибора):
# bash не считает кириллическое имя идентификатором, присваивание падает как «команда не найдена»,
# а `"$имя"` остаётся ЛИТЕРАЛОМ. В первой редакции сравнение двух таких литералов дало
# ::error::СЧЁТ ОБЪЕКТОВ РАЗОШЁЛСЯ — прибор УВЕРЕННО СОЛГАЛ О МИРЕ из значений, которых не было.
# Поэтому ниже стоит ещё и замок формы: не похоже на «число/число/число/число» ⇒ НЕ ЗНАЮ.
cnt_live="$(counts "$LIVE")"; cnt_canon="$(counts "$PROBE")"
case "$cnt_live" in [0-9]*/[0-9]*/[0-9]*/[0-9]*) ;; *) nz "счёт живой БД не снялся (получено «$cnt_live»)" ;; esac
case "$cnt_canon" in [0-9]*/[0-9]*/[0-9]*/[0-9]*) ;; *) nz "счёт зонд-БД не снялся (получено «$cnt_canon»)" ;; esac
echo "  счёт (таблиц/индексов/ограничений/колонок): живая $cnt_live · канон $cnt_canon"

diff "$work/canon.n" "$work/live.n" > "$work/d" || true
diff_all="$(grep -c '^[<>]' "$work/d" || true)"
diff_comment="$(grep '^[<>]' "$work/d" | grep -c 'COMMENT ON' || true)"
# ТРЕТИЙ КЛАСС, БЕЗ КОТОРОГО ЧИСЛО ВРЁТ: строка кода, отличающаяся ТОЛЬКО ХВОСТОВЫМ комментарием
# (`… ; -- пояснение`). Такие пары шли в «структурные» и требовали решения там, где решать нечего.
# Хвост НЕ вырезается из самих файлов сравнения — внутри строкового литерала `--` законен, и резать
# его вслепую значило бы портить предмет ради красивого числа. Поэтому классифицируем ПАРАМИ.
grep '^[<>]' "$work/d" | grep -v 'COMMENT ON' | sed 's/^[<>] //' | sed -E 's/[[:space:]]*--.*$//' \
  | sed 's/[[:space:]]*$//' | sort | uniq -c > "$work/pairs"
diff_tailcomment="$(awk '$1 % 2 == 0 {s += $1} END {print s+0}' "$work/pairs")"
diff_struct=$(( diff_all - diff_comment - diff_tailcomment ))

# ИЗВЕСТНОЕ РАСХОЖДЕНИЕ ВЫЧИТАЕТСЯ ПОИМЁННО, А НЕ ПОРОГОМ (иначе новое неотличимо от старого:
# замерено 20.08 — подсунутая лишняя колонка дала ТОТ ЖЕ rc=1, что и обычный прогон, и различала
# только надпись). Строки известного лежат в scripts/schema-known-drift.txt с объяснением, ПОЧЕМУ
# они приняты; нет файла — вычитать нечего, и это НЕ ошибка, а «известного не объявлено».
known="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/schema-known-drift.txt"
diff_known=0
if [ -f "$known" ]; then
  grep -vE '^#|^$' "$known" > "$work/known" || true
  diff_known="$(grep '^[<>]' "$work/d" | grep -v 'COMMENT ON' | sed 's/^[<>] //' \
                | grep -Fxf "$work/known" -c || true)"
  diff_struct=$(( diff_struct - diff_known ))
  [ "$diff_struct" -lt 0 ] && diff_struct=0
fi

echo "  расхождений строк: $diff_all (COMMENT ON: $diff_comment · хвостовой комментарий: $diff_tailcomment · ИЗВЕСТНОЕ принятое: $diff_known · НОВЫХ СТРУКТУРНЫХ: $diff_struct)"
[ "${1:-}" = "--подробно" ] && grep '^[<>]' "$work/d" | grep -v 'COMMENT ON' | cut -c1-160

if [ "$cnt_live" != "$cnt_canon" ]; then
  echo "::error::СЧЁТ ОБЪЕКТОВ РАЗОШЁЛСЯ — живая БД и канон описывают РАЗНЫЕ схемы"; exit 1
fi
if [ "$diff_struct" -ne 0 ]; then
  echo "::error::структурных расхождений: $diff_struct — прогоните с --подробно и решите ДО следующей приёмки"; exit 1
fi
if [ "$diff_comment" -ne 0 ]; then
  echo "  ⚠️ схемы СОВПАДАЮТ структурно, но комментарии расходятся ($diff_comment строк): канон документирован БЕДНЕЕ живой БД"
fi
[ "$diff_known" -gt 0 ] && echo "  ⚠️ ИЗВЕСТНОЕ расхождение на месте ($diff_known строк) — см. scripts/schema-known-drift.txt; оно ПРИНЯТО, а не исчезло"
echo "✅ живая БД СОВПАДАЕТ с каноном по структуре: новых расхождений НЕТ (объекты, колонки, индексы, ограничения)"
