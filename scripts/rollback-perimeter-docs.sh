#!/usr/bin/env bash
# РУБИЛЬНИК ОТКАТА документного пака периметра (форма гейта zoolink-perimeter-docs, T3).
#
# ПРЕДМЕТ: четыре файла канона, правленные 18.08.2026 (клауза 6a в ADR-0017 EN+RU, строка
# Messenger/MAX в ADR-0008 EN+RU, снятие ложного стоячего правила, счёт констант пять→шесть).
# Пак НЕ ЗАКОММИЧЕН, поэтому откат = возврат путей к состоянию HEAD, а доказательство отката —
# совпадение с blob'ами HEAD ПОБАЙТОВО, а не «на глаз».
#
# КОДЫ: 0 — откат полный · 1 — вернулось не всё (назовёт какие) · 2 — отказ до правок.
# ЗАПУСК: bash scripts/rollback-perimeter-docs.sh [--проверить|--самопроверка]
set -uo pipefail
export LC_ALL=C

PATHS=(
  docs/04-decisions/0008-rf-provider-matrix.md
  docsRU/04-decisions/0008-rf-provider-matrix.md
  docs/04-decisions/0017-rf-data-residency.md
  docsRU/04-decisions/0017-rf-data-residency.md
)

die(){ printf 'rollback-docs: ОТКАЗ — %s\n' "$1" >&2; exit 2; }

# НЕИЗВЕСТНЫЙ АРГУМЕНТ — ОТКАЗ. Урок соседнего рубильника (круг 2): любой неопознанный флаг там
# означал боевой прогон, и `--dry-run` на чистом дереве выполнил ПОЛНЫЙ откат, напечатав ✓.
case "${1:-}" in ''|--проверить|--самопроверка) ;; *) die "неизвестный аргумент «$1». Известны: --проверить, --самопроверка. Без аргументов — боевой откат" ;; esac

git rev-parse --git-dir >/dev/null 2>&1 || die "здесь не git-репозиторий (cwd=$PWD)"
cd "$(git rev-parse --show-toplevel)" || die "не нашла корень дерева"

совпал(){ git show "HEAD:$1" 2>/dev/null | cmp -s - "$1" 2>/dev/null; }

if [ "${1:-}" = "--самопроверка" ]; then
  ran=0; fails=0; declared=3
  # (1) каждый путь ОТСЛЕЖИВАЕТСЯ git — иначе «возврат к HEAD» бессмыслен
  ran=$((ran+1)); bad=""
  for p in "${PATHS[@]}"; do git ls-files --error-unmatch "$p" >/dev/null 2>&1 || bad="$bad $p"; done
  [ -z "$bad" ] && echo "  ok   все ${#PATHS[@]} пути отслеживаются git" || { echo "::error::не отслеживаются:$bad"; fails=$((fails+1)); }
  # (2) --проверить НЕ МЕНЯЕТ дерево (побайтово по индексу)
  ran=$((ran+1)); before="$(git ls-files -s | sha256sum)"
  bash "$0" --проверить >/dev/null 2>&1
  [ "$before" = "$(git ls-files -s | sha256sum)" ] && echo "  ok   --проверить дерево не трогает" || { echo "::error::--проверить ИЗМЕНИЛ дерево"; fails=$((fails+1)); }
  # (3) МУТАНТ: подложный путь в перечне обязан покраснеть И БЫТЬ НАЗВАН (пятый довод — что назвал)
  ran=$((ran+1))
  out="$(PATHS_EXTRA=1 bash -c 'source /dev/stdin <<<"$(sed "s#^PATHS=(#PATHS=(\n  docs/04-decisions/НЕТ-ТАКОГО.md#" "'"$0"'")" --самопроверка' 2>&1 || true)"
  if printf '%s' "$out" | grep -q "не отслеживаются" && printf '%s' "$out" | grep -q "НЕТ-ТАКОГО"; then
    echo "  ok   мутант «подложный путь» → красное И названо имя"
  else echo "::error::мутант «подложный путь» не покраснел или не назвал путь"; fails=$((fails+1)); fi
  echo "  самопроверка: прогнано $ran из объявленных $declared"
  [ "$ran" = "$declared" ] || { echo "::error::прогнано $ran из $declared — это НЕ ЗНАЮ"; exit 2; }
  [ "$fails" = 0 ] && { echo "✅ самопроверка рубильника документного пака пройдена"; exit 0; }
  echo "❌ самопроверка ПРОВАЛЕНА ($fails)"; exit 1
fi

if [ "${1:-}" = "--проверить" ]; then
  printf 'rollback-docs: откатило бы %s путей к HEAD:\n' "${#PATHS[@]}"
  for p in "${PATHS[@]}"; do совпал "$p" && printf '    = %s (уже совпадает с HEAD)\n' "$p" || printf '    - %s\n' "$p"; done
  exit 0
fi

for p in "${PATHS[@]}"; do git checkout -- "$p" 2>/dev/null || die "не смогла вернуть $p"; done
back=0
for p in "${PATHS[@]}"; do совпал "$p" && back=$((back+1)) || printf 'rollback-docs: НЕ вернулся %s\n' "$p" >&2; done
if [ "$back" = "${#PATHS[@]}" ]; then
  printf 'rollback-docs: ✓ откат ПОЛНЫЙ — %s из %s путей совпали с HEAD побайтово.\n' "$back" "${#PATHS[@]}"; exit 0
fi
printf 'rollback-docs: вернулось %s из %s — откат НЕПОЛНЫЙ\n' "$back" "${#PATHS[@]}" >&2; exit 1
