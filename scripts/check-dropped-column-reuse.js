#!/usr/bin/env node
/**
 * check-dropped-column-reuse.js — ZooLink gate: A DROPPED (table, column) NAME MUST NEVER BE REUSED.
 *
 * ── WHAT ────────────────────────────────────────────────────────────────────────────────────────
 * Pure STATIC analysis of `database_schema.sql` + `migrations/*.sql` (no database, no npm deps, no
 * network). It builds two sets of (table, column) pairs and intersects them:
 *
 *     D = every pair that ANY migration DROPS   (`ALTER TABLE … DROP COLUMN [IF EXISTS] x`,
 *         including multi-column ALTERs, multi-LINE ALTERs, and drops inside DO-blocks /
 *         `EXECUTE '…'` string DDL)
 *     A = every pair CREATED by the canon, or created by a migration whose number is GREATER
 *         than the migration that drops it, or re-added LATER IN THE SAME FILE than the drop
 *         (`ADD COLUMN`, `ADD COLUMN IF NOT EXISTS`, bare `ADD x TYPE`, and `CREATE TABLE` column
 *         lists — again including nested/DO/EXECUTE forms)
 *
 * It runs the SAME test one level up for whole TABLES (`DROP TABLE` vs a later `CREATE TABLE` of the
 * same name — rules R5/R6/R7). There are ZERO `DROP TABLE`s in the tree today, so that axis is free of
 * noise by construction; it exists so the identical hole is closed while closing it is still free.
 *
 * It ALSO BANS `RENAME` of a column or a table in a migration outright (rules R8/R9) — see the RENAME
 * section below. Zero renames exist in the tree today, which is exactly why the ban is being introduced
 * now: the rule costs nothing to adopt and everything to retrofit.
 *
 * D ∩ A ≠ ∅ (or any RENAME)  ⇒  exit 1 (RED).   Extractor produced implausible output, OR THIS GATE'S
 * OWN PREMISE NO LONGER HOLDS  ⇒  exit 2 (LOUD, never green).
 *
 * ── WHY (the mine this exists to catch) ─────────────────────────────────────────────────────────
 * Провижининг (backend/src/provision.ts, шаг 2) replays EVERY migration on EVERY `docker compose up`
 * — UNCONDITIONALLY. That is deliberate: replay-always is what heals a stale volume, and the
 * `migration-drift` CI job proves the replay is idempotent. But it means every `DROP COLUMN IF
 * EXISTS` in the migration set is a LIVE statement forever, not a one-time historical event.
 *
 * So if a FUTURE migration (or the canon) ever introduces a column with a name some EARLIER
 * migration drops, the order on each `up` becomes:
 *
 *     …  0018: ALTER TABLE species DROP COLUMN IF EXISTS name_ru;   ← kills yesterday's column
 *     …  00NN: ALTER TABLE species ADD COLUMN IF NOT EXISTS name_ru …;  ← recreates it, EMPTY
 *
 * The schema still looks exactly right — right table, right column, right type, drift gate green.
 * Only the DATA is gone, silently, on every single restart.
 *
 * This mine is worse than its siblings because IT LEAVES NO FOSSIL BY CONSTRUCTION. The species.market
 * mine (migration 0042) could at least be caught after the fact — the row's xmin/updated_at moved.
 * Here the column is dropped and recreated, so there is no row, no timestamp, no version, nothing to
 * point at afterwards: you cannot prove it fired, only that the data is missing. A mine you cannot
 * detect after the fact must be made IMPOSSIBLE BEFORE the fact. Hence a gate, not vigilance.
 *
 * ── WHY THIS FORM AND NOT ANOTHER ───────────────────────────────────────────────────────────────
 *  · NOT "fix the migration": ADR-0007 forbids editing an already-applied migration. 0018/0041 stay
 *    verbatim.
 *  · NOT "guard the DROP with `… only if no later migration adds it`": a migration cannot know the
 *    future. Any such guard is a lie written before the fact it must check exists.
 *  · NOT "a checklist / a review habit": the failure is invisible, so a human reviewer has nothing to
 *    notice. The only reliable place to catch it is at NAME-CHOICE time, mechanically.
 *  ⇒ The cure is a LOCK ON THE NAME: dropped names are burned. Choose another name, or (deliberately,
 *    with a reason) make the old DROP conditional in a NEW migration that guards it by existence.
 *
 * ── RENAME IS BANNED, NOT MEASURED (rules R8/R9 — holder ruling, 2026-08-08) ─────────────────────
 * A `RENAME COLUMN old TO new` is TWO events in one statement: the old name is BURNED and the new name
 * is INTRODUCED. Under the unconditional replay it is also not idempotent — the second replay of that
 * file finds no `old` column and the whole provisioning run dies (and a version GUARDED by existence is
 * worse, not better: it goes quiet and the burn of `old` is then recorded nowhere a human or this gate
 * would look). This gate therefore does not try to reason about renames; it FORBIDS them and prints the
 * prescribed replacement — add the new name (guarded) → move the data (guarded) → drop the old name
 * (guarded). Each of those three steps is replay-idempotent on its own, and the third one is what puts
 * `old` into D, so every later name choice is checked against it.
 *   Earlier this gate ABORTED (exit 2) on a rename — "I have no ruling". That was the right answer for
 *   exactly as long as there was no ruling. There is one now, so the honest exit is RED with the recipe:
 *   an exit-2 "cannot measure" on a KNOWN-forbidden construct trains people to treat 2 as noise.
 *   `RENAME CONSTRAINT` is classified as neither (a note, not a finding): it burns no column/table name,
 *   and its replay-idempotency is already gated end-to-end by the `migration-drift` job's double replay.
 *
 * ── THE GATE ASSERTS ITS OWN PREMISE (exit 2 — «моя предпосылка изменилась») ──────────────────────
 * Every rule above rests on ONE fact about a file this gate does not own: `backend/src/provision.ts`
 * replays EVERY migration on EVERY start, UNCONDITIONALLY. If that ever becomes conditional (replay only
 * on a pre-existing volume, replay behind a flag, a filtered file list), then a `DROP COLUMN` stops being
 * a live statement forever and becomes a historical event again — and this gate silently turns into a
 * needlessly strict naming police, blocking legitimate work for a reason that no longer exists.
 * A premise that does not check itself is the same mine, only inside the instrument. So the gate reads
 * provision.ts and proves (structurally, not by grepping one line) that the replay loop is there, iterates
 * the whole directory, and is enclosed by nothing conditional. If it cannot prove that, it exits 2 saying
 * MY PREMISE HAS CHANGED — deliberately neither green (silence) nor red (this is not a schema defect; it
 * is a defect of the gate's foundation, and it is fixed by re-deciding the rule, not by renaming a column).
 *
 * ── "DOESN'T `migration-drift` ALREADY CATCH THIS?" — MEASURED 2026-08-08, ephemeral PG 16, NO ─────
 * It catches the FIRST attempt and then walks the developer straight into the permanent version.
 *   Scenario A — the canon declares the column in its natural position, a later migration re-adds it.
 *     `pg_dump --schema-only` emits columns in ORDINAL order, and a dropped-then-re-added column moves
 *     to the END of the table. So the two paths differ and the drift diff goes RED — on column ORDER:
 *         -    name_ru character varying(100),
 *         -    market character varying(10) DEFAULT 'pet'::character varying
 *         +    market character varying(10) DEFAULT 'pet'::character varying,
 *         +    name_ru character varying(100)
 *     Nothing in that message mentions data. Its remedy text says "reconcile database_schema.sql with
 *     migrations/".
 *   Scenario B — the developer does exactly that: the canon is reconciled so the column sits last.
 *     MEASURED: the two dumps become BYTE-IDENTICAL → drift GREEN. And on a stale volume, one single
 *     `up` then does:  before → 'Собака','Кошка'  ·  after → NULL, NULL.
 *     The mine is now armed, permanent, and invisible to every gate in the pipeline.
 * So the drift gate's signal is real but it is about SHAPE, and its own suggested fix DISARMS the
 * signal while ARMING the mine. This gate reasons about NAMES, so it reds on the armed state in both
 * scenarios and says why. (Also measured: `xmin` does NOT change across the drop+re-add — Postgres does
 * not rewrite the rows — so not even the row-version fossil that exposed the 0007/0042 mine exists here.)
 *
 * ── FALSE-GREEN FLOOR (why a green here means something) ─────────────────────────────────────────
 * A broken extractor produces "GREEN — 0 ∩ 0" over nothing at all. That failure mode has already bitten
 * this project, so the gate refuses to report GREEN unless it can prove it actually parsed the tree:
 *   (F1) every migration file matched the `YYYYMMDD_NNNN_*.sql` name pattern (ordering must be known)
 *   (F2) file count / statement count / drop count / creation count are all at or above measured floors
 *   (F3) six SENTINEL pairs — one per PARSING PATH — must be found. Counts alone can be met by a parser
 *        that is broken on one syntactic form; sentinels pin each form individually.
 *   (F4) zero unclassified DROP-ish ALTER actions and zero unresolved dynamic (`%I`) column DDL. An
 *        action the parser could not classify is NOT silently skipped — it aborts the gate.
 * Any floor miss ⇒ exit 2 with "fix the extractor", never exit 0.
 *
 * ── SELF-TEST (the mutants that must turn this RED) ──────────────────────────────────────────────
 *   DROPPED_NAME_SELFTEST=1 node scripts/check-dropped-column-reuse.js
 * re-runs this same script against deliberately broken COPIES of its inputs (the working tree is never
 * modified) and requires the expected exit code AND a phrase only that mutation can produce:
 *   M1 canon re-adds a dropped name  → RED R1   (species.name_ru back in the canon's CREATE TABLE)
 *   M2 later migration re-adds it    → RED R2   (0099 ADD COLUMN reviews.moderation_status, dropped by 0041)
 *   M3 same file drops then re-adds  → RED R4   (drop at line N, ADD at line N+k in one file)
 *   M4 empty migrations dir          → exit 2   (the floor fires; a dead extractor is never green)
 *   M5 MULTI-LINE re-add             → RED R2   (the shape a per-line grep cannot see at all)
 *   M6 same name, DIFFERENT table    → GREEN    (anti-false-RED: pairs, not bare names)
 *   M7 DROP TABLE then re-CREATE     → RED R6   (the same mine one level up — every row, not one column)
 *   M8 a bare RENAME COLUMN          → RED R8   (the banned construct; the old name must also enter D)
 *   M9 replay made CONDITIONAL       → exit 2   (the PREMISE assert: a faked provision.ts must be caught)
 *   M10 a bare RENAME TO (table)     → RED R9   (the table-level half of the same ban)
 *
 * Usage:  node scripts/check-dropped-column-reuse.js            # the gate
 *         node scripts/check-dropped-column-reuse.js --dump     # + the full D registry, machine-readable
 * Env override (ONLY for the self-test; production always reads the tree):
 *         DROPPED_NAME_CANON=<file>  DROPPED_NAME_MIGRATIONS=<dir>  DROPPED_NAME_PROVISION=<file>
 * Exit: 0 = green · 1 = RED (a burned name is being reused, or a banned RENAME) · 2 = the gate could not
 *       measure, or ITS OWN PREMISE no longer holds (LOUD in both cases; never a silent pass).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = process.env.DROPPED_NAME_REPO || path.resolve(__dirname, '..');
const CANON = process.env.DROPPED_NAME_CANON || path.join(REPO, 'database_schema.sql');
const MIGDIR = process.env.DROPPED_NAME_MIGRATIONS || path.join(REPO, 'migrations');
// The file whose behaviour is this gate's PREMISE. Overridable ONLY so the self-test can hand the gate a
// faked one and prove the premise assert actually bites.
const PROVISION = process.env.DROPPED_NAME_PROVISION || path.join(REPO, 'backend', 'src', 'provision.ts');

// ── Measured floors (F2). Taken from the tree on 2026-08-08 at 42 migrations; RAISE them, never lower
// them, when the tree grows. They are floors, not equalities, so an added migration never reds the gate.
// WHEN TO RAISE THEM: in the SAME pack that grows the tree — the growth is recorded at the moment someone
// is already looking at the tree. This is deliberately NOT automated (a floor that re-derives itself from
// the thing it is supposed to bound is not a floor); the reminder is printed in the coverage note of every
// single run, green or not, because that note is what the person landing a pack actually reads.
const FLOOR = {
  // Measured 42 on 2026-08-08, but the floor is 41 ON PURPOSE: migration 0042 was still a pack draft
  // when this gate was authored, and a floor whose job is to detect a DEAD EXTRACTOR must not also
  // become a lock on the exact file count. If 0042 is pulled, this gate stays a gate.
  migrationFiles: 41,
  dropEvents: 13,       // measured 13 column drops (0018 ×6, 0041 ×7)
  canonColumns: 400,    // measured 504
  migrationCreations: 300, // measured 364
  canonTables: 41,      // measured 43 CREATE TABLE in canon
};

// ── Sentinels (F3): one per PARSING PATH. Each proves a syntactic form the naive parser gets wrong.
const SENTINELS = [
  { set: 'D', table: 'species', column: 'name_ru',
    why: 'single-line `ALTER TABLE … DROP COLUMN IF EXISTS` (migrations/…0018:86)' },
  { set: 'A_canon', table: 'listings', column: 'location_point',
    why: 'DDL nested TWO levels deep: DO $$ … EXECUTE \'ALTER TABLE … ADD COLUMN …\' (database_schema.sql:377). A line-grep sees it as a string, not as DDL.' },
  { set: 'A_canon', table: 'reviews', column: 'supersedes_review_id',
    why: 'column list inside CREATE TABLE (not an ALTER at all)' },
  { set: 'A_mig', table: 'service_credentials', column: 'capability_profile_id',
    why: 'MULTI-LINE ALTER: table name on one line, ADD COLUMN on the next (migrations/…0038:78-79). A line-based extractor loses the table name.' },
  { set: 'A_mig', table: 'consents', column: 'seq',
    why: 'bare `ADD COLUMN` (no IF NOT EXISTS) inside a DO-block IF (migrations/…0036:55)' },
  { set: 'A_mig', table: 'review_states', column: 'moderation_status',
    why: 'the near-miss that proves pairs, not bare names: 0041 drops reviews.moderation_status and in the SAME file creates review_states.moderation_status. A name-only gate reds here, wrongly.' },
];

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  TOKENIZER — comment-, string- and dollar-quote-aware. Splits into top-level statements, keeping
//  string/dollar bodies as separate segments so (a) their contents cannot be mistaken for DDL and
//  (b) they can be re-parsed on purpose when they really ARE executed DDL (DO / EXECUTE).
// ════════════════════════════════════════════════════════════════════════════════════════════════
function tokenize(sql, startLine) {
  const stmts = [];
  let segs = [];
  let cur = '';
  let line = startLine || 1;
  let stmtLine = line;
  let i = 0;
  const n = sql.length;

  const flushSql = () => { if (cur.length) { segs.push({ k: 'sql', t: cur }); cur = ''; } };
  // The statement's reported line is the line of its first REAL character, not of the previous
  // statement's `;`. Leading comments and blank lines must not be attributed to it: a gate that cites
  // the wrong line teaches people to distrust its citations.
  const markStart = () => { if (!segs.length && !cur.trim()) stmtLine = line; };
  const endStmt = () => {
    flushSql();
    if (segs.some((s) => s.k === 'sql' ? s.t.trim() : true)) stmts.push({ segs, line: stmtLine });
    segs = [];
    stmtLine = line;
  };
  const bump = (s) => { for (let k = 0; k < s.length; k++) if (s[k] === '\n') line++; };

  while (i < n) {
    const c = sql[i];
    const c2 = sql.substr(i, 2);

    if (c2 === '--') {                                  // line comment
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      cur += ' ';
      continue;
    }
    if (c2 === '/*') {                                  // block comment (PG nests them)
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (sql.substr(i, 2) === '/*') { depth++; i += 2; continue; }
        if (sql.substr(i, 2) === '*/') { depth--; i += 2; continue; }
        if (sql[i] === '\n') line++;
        i++;
      }
      cur += ' ';
      continue;
    }
    if (c === "'") {                                    // single-quoted literal ('' escapes)
      markStart();
      let j = i + 1, body = '';
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { body += "'"; j += 2; continue; }
          j++; break;
        }
        body += sql[j]; j++;
      }
      bump(sql.slice(i, j));
      flushSql();
      segs.push({ k: 'str', t: body, q: "'" });
      cur += ` ${STR_PLACEHOLDER} `;
      i = j;
      continue;
    }
    if (c === '"') {                                    // quoted identifier — stays inline as SQL
      markStart();
      let j = i + 1, body = '"';
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { body += '""'; j += 2; continue; }
          body += '"'; j++; break;
        }
        body += sql[j]; j++;
      }
      bump(sql.slice(i, j));
      cur += body;
      i = j;
      continue;
    }
    if (c === '$') {                                    // dollar-quoted body  $tag$ … $tag$
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        markStart();
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const bodyStart = i + tag.length;
        const bodyEnd = close === -1 ? n : close;
        const body = sql.slice(bodyStart, bodyEnd);
        const bodyLine = line + countNl(sql.slice(i, bodyStart));
        bump(sql.slice(i, close === -1 ? n : close + tag.length));
        flushSql();
        segs.push({ k: 'str', t: body, q: tag, line: bodyLine });
        cur += ` ${STR_PLACEHOLDER} `;
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    if (c === ';') { endStmt(); i++; continue; }
    if (!/\s/.test(c)) markStart();
    if (c === '\n') line++;
    cur += c;
    i++;
  }
  endStmt();
  return stmts;
}
const STR_PLACEHOLDER = '#str#';
function countNl(s) { let k = 0; for (const ch of s) if (ch === '\n') k++; return k; }

// ── identifier helpers ──────────────────────────────────────────────────────────────────────────
function readIdent(text, pos) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  let name = '';
  if (text[i] === '"') {
    i++;
    while (i < text.length) {
      if (text[i] === '"') { if (text[i + 1] === '"') { name += '"'; i += 2; continue; } i++; break; }
      name += text[i]; i++;
    }
  } else {
    const m = /^[A-Za-z_%][A-Za-z0-9_$%]*/.exec(text.slice(i));
    if (!m) return null;
    name = m[0];
    i += m[0].length;
  }
  // schema-qualified: consume `.next`
  if (text[i] === '.') {
    const rest = readIdent(text, i + 1);
    if (rest) return { name: rest.name, end: rest.end, schema: name };
  }
  return { name, end: i };
}
const norm = (s) => s.replace(/"/g, '').toLowerCase();

// split at depth-0 commas
function splitTop(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const CONSTRAINT_WORDS = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like', 'period']);
const NON_COLUMN_DROPS = new Set(['constraint', 'default', 'not', 'identity', 'expression', 'generated']);

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  EXTRACTOR — walks statements, records column CREATE / DROP events, and reports anything it could
//  not classify (never silently skips).
// ════════════════════════════════════════════════════════════════════════════════════════════════
function extract(sql, file, ctxIn) {
  const ctx = ctxIn || { executed: true, nested: false, baseLine: 1 };
  const events = [];   // {kind:'add'|'drop'|'create_table', table, column, file, line, seq, executed, nested, form}
  const problems = []; // {severity:'abort'|'note', file, line, msg}
  let seq = 0;

  const stmts = tokenize(sql, ctx.baseLine);

  for (const st of stmts) {
    const flat = st.segs.map((s) => (s.k === 'sql' ? s.t : ` ${STR_PLACEHOLDER} `)).join('');
    const squashed = flat.replace(/\s+/g, ' ').trim();
    const line = st.line;

    // ---- CREATE TABLE ------------------------------------------------------------------------
    const ctRe = /\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP\s+|TEMPORARY\s+|UNLOGGED\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi;
    let m;
    while ((m = ctRe.exec(flat)) !== null) {
      const id = readIdent(flat, m.index + m[0].length);
      if (!id) { problems.push({ severity: 'abort', file, line, msg: `CREATE TABLE with an unreadable table name: ${squashed.slice(0, 120)}` }); continue; }
      const open = flat.indexOf('(', id.end);
      if (open === -1) {                                  // CREATE TABLE … AS SELECT — no column list
        problems.push({ severity: 'note', file, line, msg: `CREATE TABLE ${id.name} has no column list (AS SELECT / OF type) — no columns extracted` });
        continue;
      }
      const close = matchingParen(flat, open);
      if (close === -1) { problems.push({ severity: 'abort', file, line, msg: `CREATE TABLE ${id.name}: unbalanced parentheses` }); continue; }
      for (const item of splitTop(flat.slice(open + 1, close))) {
        const t = item.trim();
        if (!t) continue;
        const first = readIdent(t, 0);
        if (!first) continue;
        if (CONSTRAINT_WORDS.has(norm(first.name))) continue;
        events.push({ kind: 'create_table', table: norm(id.name), column: norm(first.name), file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: 'CREATE TABLE' });
      }
    }

    // ---- ALTER TABLE -------------------------------------------------------------------------
    const atRe = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/gi;
    const hits = [];
    while ((m = atRe.exec(flat)) !== null) hits.push(m.index + m[0].length);
    for (let h = 0; h < hits.length; h++) {
      const id = readIdent(flat, hits[h]);
      if (!id) { problems.push({ severity: 'abort', file, line, msg: `ALTER TABLE with an unreadable table name: ${squashed.slice(0, 120)}` }); continue; }
      // bound this ALTER's action list at the next ALTER TABLE in the same statement (if any)
      const nextStart = h + 1 < hits.length ? flat.lastIndexOf('ALTER', hits[h + 1]) : flat.length;
      const rest = flat.slice(id.end, nextStart < 0 ? flat.length : nextStart);
      for (const raw of splitTop(rest)) {
        const act = raw.trim();
        if (!act) continue;
        const head = /^([A-Za-z]+)\s*/.exec(act);
        if (!head) continue;
        const verb = head[1].toLowerCase();

        if (verb === 'add') {
          let p = head[0].length;
          let explicitColumn = false;
          let mm = /^COLUMN\s+/i.exec(act.slice(p));
          if (mm) { explicitColumn = true; p += mm[0].length; }
          mm = /^IF\s+NOT\s+EXISTS\s+/i.exec(act.slice(p));
          if (mm) p += mm[0].length;
          const cid = readIdent(act, p);
          if (!cid) { problems.push({ severity: 'abort', file, line, msg: `unparseable ADD action on ${id.name}: ${act.slice(0, 120)}` }); continue; }
          if (!explicitColumn && CONSTRAINT_WORDS.has(norm(cid.name))) continue;  // ADD CONSTRAINT/UNIQUE/...
          if (!explicitColumn && !act.slice(cid.end).trim()) {                    // `ADD x` with no type
            problems.push({ severity: 'abort', file, line, msg: `ambiguous ADD action on ${id.name} (no type follows): ${act.slice(0, 120)}` });
            continue;
          }
          recordCol(events, problems, { kind: 'add', table: id.name, column: cid.name, file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: explicitColumn ? 'ADD COLUMN' : 'ADD <col> (implicit COLUMN)' });
          continue;
        }

        if (verb === 'drop') {
          let p = head[0].length;
          let explicitColumn = false;
          let mm = /^COLUMN\s+/i.exec(act.slice(p));
          if (mm) { explicitColumn = true; p += mm[0].length; }
          mm = /^IF\s+EXISTS\s+/i.exec(act.slice(p));
          if (mm) p += mm[0].length;
          const cid = readIdent(act, p);
          if (!cid) { problems.push({ severity: 'abort', file, line, msg: `unparseable DROP action on ${id.name}: ${act.slice(0, 120)}` }); continue; }
          if (!explicitColumn && NON_COLUMN_DROPS.has(norm(cid.name))) continue;  // DROP CONSTRAINT / DEFAULT / NOT NULL
          recordCol(events, problems, { kind: 'drop', table: id.name, column: cid.name, file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: explicitColumn ? 'DROP COLUMN' : 'DROP <col> (implicit COLUMN)' });
          continue;
        }

        if (verb === 'rename') {
          // RULING (holder, 2026-08-08): a RENAME of a column or a table in a migration is FORBIDDEN.
          // It is two events at once (old name burned + new name introduced) and it is not idempotent
          // under the unconditional replay. So it is classified, not aborted on: the old name is
          // recorded as a DROP (it must enter D, or the ban would be only half a rule), the new column
          // name as a creation, and a RENAME event is emitted that reds the gate on its own.
          let p = head[0].length;
          const rest2 = act.slice(p);

          const toTable = /^TO\s+/i.exec(rest2);
          if (toTable) {                                   // ALTER TABLE old RENAME TO new
            const nid = readIdent(act, p + toTable[0].length);
            if (!nid) { problems.push({ severity: 'abort', file, line, msg: `unparseable RENAME TO on ${id.name}: ${act.slice(0, 120)}` }); continue; }
            if (norm(id.name).includes('%') || norm(nid.name).includes('%')) {
              problems.push({ severity: 'abort', file, line, msg: `RENAME TO with an unresolved %-placeholder — the gate cannot know which table this renames.` });
              continue;
            }
            // The OLD table name is burned exactly like a DROP TABLE: the table survives under the NEW
            // name, but re-creating the OLD name later yields an EMPTY table on every replay.
            events.push({ kind: 'drop_table', table: norm(id.name), column: '', file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: `RENAME TO ${norm(nid.name)}` });
            events.push({ kind: 'rename', table: norm(id.name), column: '', newName: norm(nid.name), scope: 'table', file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: `ALTER TABLE ${norm(id.name)} RENAME TO ${norm(nid.name)}` });
            continue;
          }

          if (/^CONSTRAINT\s+/i.test(rest2)) {
            // Not a column and not a table name: nothing enters D. Its replay-idempotency is already
            // gated end-to-end by `migration-drift` (which replays the whole set TWICE), so reporting it
            // is enough — banning it here would forbid the very guarded form that fixes it.
            problems.push({ severity: 'note', file, line, msg: `ALTER TABLE ${id.name} RENAME CONSTRAINT — not a column/table NAME event (nothing burned); its replay-idempotency is the migration-drift job's axis, not this gate's` });
            continue;
          }

          const mmCol = /^COLUMN\s+/i.exec(rest2);
          if (mmCol) p += mmCol[0].length;
          const oldId = readIdent(act, p);
          const toKw = oldId ? /^\s*TO\s+/i.exec(act.slice(oldId.end)) : null;
          const newId = toKw ? readIdent(act, oldId.end + toKw[0].length) : null;
          if (!oldId || !toKw || !newId) {
            problems.push({ severity: 'abort', file, line, msg: `RENAME action on ${id.name} in a shape this gate cannot classify — classify it on purpose instead of letting it through: ${act.slice(0, 160)}` });
            continue;
          }
          recordCol(events, problems, { kind: 'drop', table: id.name, column: oldId.name, file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: `RENAME COLUMN → ${norm(newId.name)} (old name BURNED)` });
          recordCol(events, problems, { kind: 'add', table: id.name, column: newId.name, file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: `RENAME COLUMN ← ${norm(oldId.name)}` });
          recordCol(events, problems, { kind: 'rename', table: id.name, column: oldId.name, newName: norm(newId.name), scope: 'column', file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: `ALTER TABLE ${norm(id.name)} RENAME COLUMN ${norm(oldId.name)} TO ${norm(newId.name)}` });
          continue;
        }

        if (verb === 'alter') {
          // `ALTER [COLUMN] x <sub>` — changes a column, never creates or removes one. The sub-verbs
          // that legitimately contain the word DROP are DROP DEFAULT / DROP NOT NULL / DROP EXPRESSION /
          // DROP IDENTITY. Allow-listed EXPLICITLY, not by "it starts with ALTER, close enough": an
          // unrecognised sub-verb aborts, because that is where a future blind spot would enter.
          let p = head[0].length;
          const mm = /^COLUMN\s+/i.exec(act.slice(p));
          if (mm) p += mm[0].length;
          const cid = readIdent(act, p);
          const sub = cid ? /^\s*([A-Za-z]+)/.exec(act.slice(cid.end)) : null;
          const subVerb = sub ? sub[1].toLowerCase() : '';
          if (['set', 'drop', 'type', 'add', 'reset'].includes(subVerb)) continue;
          problems.push({ severity: 'abort', file, line, msg: `ALTER COLUMN action on ${id.name} with an unrecognised sub-verb "${subVerb}" — classify it on purpose instead of letting the gate skip it: ${act.slice(0, 160)}` });
          continue;
        }

        // Anything else (SET …, ENABLE …, VALIDATE …, OWNER TO …, ATTACH PARTITION …) is not a column
        // create/drop — but if it MENTIONS drop/add at all, refuse to skip it quietly (F4).
        if (/\b(DROP|ADD)\b/i.test(act)) {
          problems.push({ severity: 'abort', file, line, msg: `ALTER action on ${id.name} mentions ADD/DROP but did not classify — the extractor may be blind to a new form: ${act.slice(0, 160)}` });
        }
      }
    }

    // ---- DROP TABLE ---------------------------------------------------------------------------
    // The SAME mine one level up: a dropped TABLE name that a later CREATE TABLE reuses is wiped on
    // every provisioning replay. There are ZERO `DROP TABLE`s in the tree today, so this axis costs
    // nothing and can produce no noise — it is here so the hole is closed while it is still free.
    const dtRe = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?/gi;
    while ((m = dtRe.exec(flat)) !== null) {
      let p2 = m.index + m[0].length;
      for (;;) {
        const tid = readIdent(flat, p2);
        if (!tid) { problems.push({ severity: 'abort', file, line, msg: `DROP TABLE with an unreadable table name: ${squashed.slice(0, 120)}` }); break; }
        if (tid.name.includes('%')) {
          problems.push({ severity: 'abort', file, line, msg: `DROP TABLE with an unresolved %-placeholder — the gate cannot know which table this drops.` });
        } else {
          events.push({ kind: 'drop_table', table: norm(tid.name), column: '', file, line, seq: seq++, executed: ctx.executed, nested: ctx.nested, form: 'DROP TABLE' });
        }
        const after = flat.slice(tid.end);
        const comma = /^\s*,/.exec(after);
        if (!comma) break;
        p2 = tid.end + comma[0].length;
      }
    }

    // ---- recurse into bodies that really ARE executed DDL -------------------------------------
    const isDo = /^\s*DO\b/i.test(squashed);
    const isFunc = /^\s*CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b/i.test(squashed);
    const hasExecute = /\bEXECUTE\b/i.test(squashed);
    for (const s of st.segs) {
      if (s.k !== 'str') continue;
      const looksDdl = /\b(ALTER|CREATE)\s+TABLE\b/i.test(s.t);
      if (isDo || (hasExecute && ctx.executed && !isFunc)) {
        const sub = extract(s.t, file, { executed: true, nested: true, baseLine: s.line || line });
        for (const e of sub.events) events.push(Object.assign(e, { seq: seq++, nested: true, line: e.line || line }));
        for (const p of sub.problems) problems.push(p);
      } else if (isFunc && looksDdl) {
        // A function BODY is not executed at migration time — it runs when the trigger/function is
        // called. Reported so it is visible, deliberately NOT counted in D or A.
        problems.push({ severity: 'note', file, line, msg: `column DDL inside a FUNCTION body (deferred, not migration-time) — reported, not counted` });
      } else if (looksDdl) {
        problems.push({ severity: 'abort', file, line, msg: `a string literal contains column DDL but its statement is neither DO nor EXECUTE — the extractor cannot tell whether it runs: ${s.t.replace(/\s+/g, ' ').slice(0, 160)}` });
      }
    }
  }
  return { events, problems };
}

// %I / %s placeholders mean a dynamic name the gate cannot resolve — abort, never assume.
function recordCol(events, problems, ev) {
  if (ev.table.includes('%') || ev.column.includes('%')) {
    problems.push({ severity: 'abort', file: ev.file, line: ev.line, msg: `dynamic column DDL with an unresolved %-placeholder (${ev.table}.${ev.column}) — the gate cannot know which name this touches. Resolve it or add an explicit ruling.` });
    return;
  }
  ev.table = norm(ev.table);
  ev.column = norm(ev.column);
  events.push(ev);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PREMISE ASSERT — the gate checks its OWN foundation instead of assuming it.
//
//  Every rule in this gate is true only because `backend/src/provision.ts` replays EVERY migration on
//  EVERY start, UNCONDITIONALLY. That is a fact about a file this gate does not own, so it is verified,
//  not trusted. Verified STRUCTURALLY, not by matching one line: a line-match would (a) break on any
//  reformatting and (b) keep passing if the same line got wrapped in an `if`. What is checked:
//    P1  exactly ONE `for (const … of migrations)` loop exists that reads a file and executes it
//    P2  nothing CONDITIONAL encloses that loop (only `try` / `finally` / `function main` may)
//    P3  no `return` can short-circuit main() before the loop is reached
//    P4  the `migrations` list is the whole directory (readdirSync + sort, no slice, no ternary)
//    P5  the loop body cannot skip a file (`continue`)
//    P6  main() is actually invoked at top level
//    P0  if provision.ts carries the optional machine-readable contract marker, it must say
//        UNCONDITIONAL; if it is absent, that is a NOTE (the structural proof stands on its own)
//  Failure direction is exit 2, ALWAYS loud: the gate cannot be silently green on an unverified premise,
//  and it must not be red either — a changed premise is not a schema defect.
//
//  The scanner blanks comments and string/template literals so their braces cannot move the depth. It
//  does NOT distinguish a regex literal from division (measured on today's provision.ts: harmless — no
//  regex literal there contains an unbalanced brace). If that ever stops being true the brace depth goes
//  wrong and this check FAILS LOUD (exit 2). It cannot fail quiet, which is the property that matters.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const REPLAY_CONTRACT_MARKER = /GATE-CONTRACT:\s*MIGRATION_REPLAY\s*=\s*([A-Za-z_]+)/;

/** Blank out comments and string/template literals, PRESERVING LENGTH and newlines (so indices and
 *  line numbers still refer to the original source). */
function blankTs(src) {
  const buf = src.split('');
  const blank = (from, to) => { for (let k = from; k < to && k < buf.length; k++) if (buf[k] !== '\n') buf[k] = ' '; };
  let i = 0;
  const n = src.length;
  const skipQuoted = (j, q) => {                       // j points AT the opening quote
    j++;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === q) return j + 1;
      if (src[j] === '\n' && q !== '`') return j;       // unterminated '/" — stop at the newline
      j++;
    }
    return n;
  };
  const skipTemplate = (j) => {                        // j points AT the backtick
    j++;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') return j + 1;
      if (src[j] === '$' && src[j + 1] === '{') {       // interpolation: brace-balanced, may nest
        j += 2;
        let depth = 1;
        while (j < n && depth > 0) {
          if (src[j] === '`') { j = skipTemplate(j); continue; }
          if (src[j] === "'" || src[j] === '"') { j = skipQuoted(j, src[j]); continue; }
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          j++;
        }
        continue;
      }
      j++;
    }
    return n;
  };
  while (i < n) {
    const c = src[i];
    const c2 = src.substr(i, 2);
    if (c2 === '//') { const nl = src.indexOf('\n', i); const end = nl === -1 ? n : nl; blank(i, end); i = end; continue; }
    if (c2 === '/*') { const end = src.indexOf('*/', i + 2); const e = end === -1 ? n : end + 2; blank(i, e); i = e; continue; }
    if (c === "'" || c === '"') { const e = skipQuoted(i, c); blank(i, e); i = e; continue; }
    if (c === '`') { const e = skipTemplate(i); blank(i, e); i = e; continue; }
    i++;
  }
  return buf.join('');
}

function matchBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The chain of `{` blocks enclosing `target`, each with the source text that HEADS it. */
function enclosingBlocks(code, target) {
  const stack = [];
  for (let i = 0; i < target; i++) {
    if (code[i] === '{') {
      let s = i - 1;
      while (s >= 0 && !';{}'.includes(code[s])) s--;
      stack.push({ header: code.slice(s + 1, i).replace(/\s+/g, ' ').trim(), at: i });
    } else if (code[i] === '}') stack.pop();
  }
  return stack;
}

function checkPremise() {
  const fails = [];
  const notes = [];
  let raw;
  try { raw = fs.readFileSync(PROVISION, 'utf8'); } catch (e) {
    return { fails: [`cannot read the provisioner at ${PROVISION}: ${e.message}. The gate's premise is a fact about THAT file; with the file gone the premise is unverifiable, not "fine".`], notes };
  }
  const code = blankTs(raw);
  // Cite the file the gate ACTUALLY read (the self-test hands it a mutant copy): a citation that names a
  // file it did not open teaches people to distrust every other citation this gate makes.
  const SRC = path.basename(PROVISION);
  const lineOf = (idx) => raw.slice(0, idx).split('\n').length;

  // P0 — the optional machine-readable contract line (read from the RAW text: it lives in a comment).
  const mk = REPLAY_CONTRACT_MARKER.exec(raw);
  if (mk && mk[1].toUpperCase() !== 'UNCONDITIONAL') {
    fails.push(`provision.ts declares GATE-CONTRACT: MIGRATION_REPLAY=${mk[1]} — the gate's premise is UNCONDITIONAL. The provisioner itself now says otherwise.`);
  }
  if (!mk) {
    notes.push('provision.ts carries no `GATE-CONTRACT: MIGRATION_REPLAY=UNCONDITIONAL` marker — the structural proof below stands on its own, but a one-line marker would make the contract legible to a human editing that file (see the report footer for the exact line to add).');
  }

  // P1 — the replay loop.
  const loops = [];
  const loopRe = /for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+migrations\s*\)\s*\{/g;
  let m;
  while ((m = loopRe.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(code, open);
    if (close === -1) continue;
    const body = code.slice(open, close);
    if (/\.query\s*\(/.test(body) && /readFileSync\s*\(/.test(body)) loops.push({ start: m.index, open, close });
  }
  if (loops.length !== 1) {
    fails.push(loops.length === 0
      ? 'no `for (const … of migrations) { … readFileSync … .query … }` loop found in provision.ts. Either the replay was removed, or it was rewritten into a shape this assert cannot recognise (e.g. `for (const f of schemaPresent ? [] : migrations)`, a filtered copy of the list, or a helper). Both cases mean the premise is UNPROVEN.'
      : `${loops.length} candidate replay loops found in provision.ts — the assert cannot tell which one is THE replay, so it refuses to certify any of them.`);
    return { fails, notes };
  }
  const loop = loops[0];

  // P2 — nothing conditional encloses it.
  let sawMain = false;
  for (const b of enclosingBlocks(code, loop.start)) {
    if (b.header === 'try' || b.header === 'finally') continue;
    if (/^(export\s+)?(async\s+)?function\s+main\b/.test(b.header)) { sawMain = true; continue; }
    fails.push(`the replay loop is nested inside a block this gate cannot certify as unconditional — ${SRC}:${lineOf(b.at)} opens \`${b.header.slice(-120)} {\`. Only \`try\`, \`finally\` and \`function main\` may enclose the replay; anything else (an \`if\`, an \`else\`, a \`catch\`, a callback that may not be called) means some migrations may not be replayed on some starts.`);
  }
  if (!sawMain) fails.push('the replay loop is not inside `function main()` of provision.ts — the assert can no longer trace it to a code path that always runs.');

  // P3 — nothing can return out of main() before the loop.
  const mainM = /(?:export\s+)?(?:async\s+)?function\s+main\b[^{]*\{/.exec(code);
  if (!mainM) {
    fails.push('provision.ts no longer declares `function main()` — the assert cannot establish which code path runs at all.');
  } else {
    const mainOpen = mainM.index + mainM[0].length - 1;
    const before = code.slice(mainOpen, loop.start);
    const retRe = /\breturn\b/g;
    let r;
    while ((r = retRe.exec(before)) !== null) {
      const abs = mainOpen + r.index;
      const nested = enclosingBlocks(code, abs).some((b) => b.at > mainOpen && (/=>/.test(b.header) || /\bfunction\b/.test(b.header)));
      if (nested) continue;                            // a `return` inside a nested callback is not an exit from main
      fails.push(`${SRC}:${lineOf(abs)} can \`return\` from main() BEFORE the replay loop — that is exactly how the replay would become conditional without any \`if\` around the loop itself.`);
    }
  }

  // P4 — the list is the whole directory.
  const listM = /const\s+migrations\s*=\s*([\s\S]*?);/.exec(code);
  if (!listM) {
    fails.push('provision.ts no longer builds a `const migrations = …` list — the assert cannot tell WHAT is being replayed.');
  } else {
    const expr = listM[1].replace(/\s+/g, ' ');
    if (!/readdirSync\s*\(/.test(expr)) fails.push(`the \`migrations\` list is no longer read from the directory (\`readdirSync\` is gone): ${expr.slice(0, 160)}`);
    if (!/\.sort\s*\(/.test(expr)) fails.push(`the \`migrations\` list is no longer \`.sort()\`ed — replay ORDER is the whole basis of "earlier drop, later add": ${expr.slice(0, 160)}`);
    if (/\.slice\s*\(/.test(expr)) fails.push(`the \`migrations\` list is \`.slice()\`d — the replay no longer covers the whole set: ${expr.slice(0, 160)}`);
    if (/\?/.test(expr)) fails.push(`the \`migrations\` list is built with a conditional expression — the replay set now depends on state: ${expr.slice(0, 160)}`);
  }

  // P5 — the loop cannot skip a file.
  if (/\bcontinue\b/.test(code.slice(loop.open, loop.close))) {
    fails.push('the replay loop body contains a `continue` — some migrations may be skipped, so "every DROP is a live statement forever" is no longer guaranteed.');
  }

  // P6 — main() actually runs.
  let depth = 0;
  let topLevel = '';
  for (const ch of code) {
    if (ch === '{') { depth++; topLevel += ' '; continue; }
    if (ch === '}') { depth--; topLevel += ' '; continue; }
    topLevel += depth === 0 ? ch : (ch === '\n' ? '\n' : ' ');
  }
  if (!/\bmain\s*\(\s*\)/.test(topLevel)) {
    fails.push('provision.ts never calls `main()` at top level — the replay code exists but the assert cannot show it runs.');
  }

  return { fails, notes, provisionLine: mainM ? lineOf(loop.start) : 0 };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  GATE
// ════════════════════════════════════════════════════════════════════════════════════════════════
const NAME_RE = /^(\d{8})_(\d{4})_.+\.sql$/;
const out = [];
const say = (s) => { out.push(s); console.log(s); };
let coveragePrinted = false;
// Filled in as the run progresses, so the coverage note can print what THIS run actually measured even
// when the run ends early. Its default is a statement of ignorance, never a plausible-looking zero.
const MEASURED = { text: 'nothing — the gate stopped before it finished parsing the tree' };

function coverage() {
  if (coveragePrinted) return;
  coveragePrinted = true;
  console.log('');
  console.log('→ FLOORS ARE ONE-WAY — RAISE THEM IN THE PACK THAT GROWS THE TREE:');
  console.log(`    migrations ≥ ${FLOOR.migrationFiles} · column drops ≥ ${FLOOR.dropEvents} · canon columns ≥ ${FLOOR.canonColumns} · migration columns ≥ ${FLOOR.migrationCreations} · canon tables ≥ ${FLOOR.canonTables}   (in scripts/check-dropped-column-reuse.js, const FLOOR)`);
  console.log(`    measured THIS run: ${MEASURED.text}`);
  console.log('    These floors only prove the extractor is ALIVE (a dead parser reports "GREEN — 0 ∩ 0" and looks');
  console.log('    identical to a healthy tree). They are floors, so growth never reds them — which is exactly why');
  console.log('    they rot silently: after ten added migrations a floor of 41 would pass over a parser that read');
  console.log('    one file. YOU, landing a pack that adds migrations or columns, raise them IN THAT PACK — the');
  console.log('    tree\'s growth is recorded at the one moment somebody is already looking at the tree. This is');
  console.log('    deliberately not automated: a floor that re-derives itself from the thing it bounds is not a floor.');
  console.log('');
  console.log('→ COVERAGE (printed on EVERY outcome — green, red or inconclusive; a sensor must name its own blind spot):');
  console.log('    I SEE: DROP COLUMN / ADD COLUMN / CREATE TABLE columns in the canon and in every migration,');
  console.log('    including multi-column ALTERs, multi-LINE ALTERs, and DDL nested inside DO-blocks and');
  console.log('    EXECUTE string literals. I compare (table, column) PAIRS, never bare names.');
  console.log('    I DO NOT SEE: (a) a column name built at runtime (EXECUTE format(\'… %I …\')) — I ABORT on');
  console.log('    those instead of guessing; (b) DDL inside a FUNCTION body — it runs when the function is');
  console.log('    called, not at migration time, so it is reported and not counted; (c) data loss from any');
  console.log('    cause other than name reuse (TRUNCATE, DELETE, a type change, a table drop);');
  console.log('    (d) anything about WHETHER the drop was right — only whether its name is being reused.');
  console.log('    I am STATIC: I never connect to a database, so I cannot see what a live volume already lost.');
  console.log('    RENAMES: I red on ANY column/table RENAME in a migration (R8/R9) — I do NOT try to tell a bare');
  console.log('    rename from one guarded by an existence check, because the ruling forbids both forms: even a');
  console.log('    guarded rename burns the old name silently. `RENAME CONSTRAINT` is a note, not a finding.');
  console.log('    I ALSO ASSERT MY OWN PREMISE against backend/src/provision.ts (unconditional replay of the whole');
  console.log('    migration set). If that assert cannot be satisfied I exit 2 — never green, never red.');
}

function die(code, msgs) {
  for (const m of msgs) console.log(m);
  coverage();
  process.exit(code);
}

// ── self-test driver ────────────────────────────────────────────────────────────────────────────
if (process.env.DROPPED_NAME_SELFTEST === '1') {
  const os = require('os');
  const { execFileSync } = require('child_process');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-dropname-selftest-'));
  let failed = 0;
  let ran = 0;

  const mkTree = (label) => {
    const d = path.join(work, label);
    fs.mkdirSync(path.join(d, 'migrations'), { recursive: true });
    fs.copyFileSync(CANON, path.join(d, 'database_schema.sql'));
    for (const f of fs.readdirSync(MIGDIR)) {
      if (f.endsWith('.sql')) fs.copyFileSync(path.join(MIGDIR, f), path.join(d, 'migrations', f));
    }
    return d;
  };

  const byCode = { 0: 0, 1: 0, 2: 0 };
  const runMutant = (label, wantCode, needles, build) => {
    ran++;
    byCode[wantCode] = (byCode[wantCode] || 0) + 1;
    const d = mkTree(label);
    // A mutant may also need to point the gate at a FAKED premise file (M9) — it says so by returning
    // extra env. Returning nothing keeps the real backend/src/provision.ts, which every other mutant
    // needs: their axis is the SQL tree, and a broken premise there would mask it with an exit 2.
    const extraEnv = build(d) || {};
    console.log('');
    console.log(`→ SELF-TEST ${label}: re-running the gate against a broken COPY of its inputs (must exit ${wantCode})`);
    let code = 0, log = '';
    try {
      log = execFileSync(process.execPath, [__filename], {
        env: Object.assign({}, process.env, {
          DROPPED_NAME_SELFTEST: '',
          DROPPED_NAME_CANON: path.join(d, 'database_schema.sql'),
          DROPPED_NAME_MIGRATIONS: path.join(d, 'migrations'),
        }, extraEnv),
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      code = e.status === undefined ? -1 : e.status;
      log = `${e.stdout || ''}${e.stderr || ''}`;
    }
    // An exit code alone proves nothing: exit 2 means the child ABORTED during measurement and never
    // compared anything, which would be a false green about a false-green detector. So each mutant pins
    // its EXACT exit code AND a phrase only its own mutation can produce.
    if (code !== wantCode) {
      console.log(`::error::SELF-TEST ${label} FAILED — child exit ${code}, expected ${wantCode}. ${code === 0 ? 'The gate stayed GREEN on a broken input: it is blind to exactly what it claims to catch.' : 'A different exit code means it red-ed (or aborted) for some OTHER reason, which proves nothing about this axis.'}`);
      console.log(log.split('\n').slice(-25).map((l) => `    ${l}`).join('\n'));
      failed = 1;
      return;
    }
    for (const needle of needles) {
      if (!log.includes(needle)) {
        console.log(`::error::SELF-TEST ${label} INCONCLUSIVE — exit ${code} was right, but the output never mentions "${needle}", so the gate did not red for the reason this mutant creates:`);
        console.log(log.split('\n').slice(-25).map((l) => `    ${l}`).join('\n'));
        failed = 1;
        return;
      }
    }
    console.log(`   ✓ ${label}: exit ${code} for the right reason.`);
  };

  // M1 — the canon re-introduces a dropped name (rule R1).
  runMutant('M1-canon-readds-dropped-name', 1, ['species.name_ru', 'R1'], (d) => {
    const f = path.join(d, 'database_schema.sql');
    const src = fs.readFileSync(f, 'utf8');
    const anchor = 'CREATE TABLE species (';
    if (!src.includes(anchor)) throw new Error(`self-test anchor "${anchor}" not found in the canon — fix the self-test, do not weaken the gate`);
    fs.writeFileSync(f, src.replace(anchor, `${anchor}\n    name_ru VARCHAR(100),  -- SELFTEST-M1 mutant`));
  });

  // M2 — a LATER migration re-introduces a name an EARLIER migration drops (rule R2).
  runMutant('M2-later-migration-readds', 1, ['reviews.moderation_status', 'R2'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '29990101_0099_selftest_readd.sql'),
      '-- SELFTEST-M2 mutant\nALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) NOT NULL DEFAULT \'PENDING\';\n');
  });

  // M3 — one file drops a column and re-adds it FURTHER DOWN THE SAME FILE (rule R4).
  runMutant('M3-same-file-drop-then-readd', 1, ['R4'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '29990102_0098_selftest_samefile.sql'),
      '-- SELFTEST-M3 mutant\nALTER TABLE listings DROP COLUMN IF EXISTS selftest_probe;\nALTER TABLE listings ADD COLUMN IF NOT EXISTS selftest_probe TEXT;\n');
  });

  // M4 — a dead extractor / empty input must ABORT, never report "GREEN — 0 ∩ 0".
  runMutant('M4-empty-migrations-dir-floor', 2, ['fix the extractor'], (d) => {
    for (const f of fs.readdirSync(path.join(d, 'migrations'))) fs.unlinkSync(path.join(d, 'migrations', f));
  });

  // M5 — the SAME reuse, written in the MULTI-LINE form (table name on its own line). This is the shape
  // a line-based `grep 'ALTER TABLE (\w+) ADD COLUMN (\w+)'` cannot see at all: on the ADD line there is
  // no table name, and on the ALTER line there is no column. It proves the statement-level tokenizer is
  // load-bearing for the VERDICT, not merely for a sentinel.
  runMutant('M5-multiline-readd-invisible-to-line-grep', 1, ['species.name_ru', 'R2'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '29990103_0097_selftest_multiline.sql'),
      '-- SELFTEST-M5 mutant: the re-add split across lines, invisible to a per-line grep\nALTER TABLE species\n    ADD COLUMN IF NOT EXISTS name_ru\n        VARCHAR(100);\n');
  });

  // M6 — ANTI-FALSE-RED control (the gate must STAY GREEN). The same bare column name on a DIFFERENT
  // table is not a reuse. A name-only gate reds here and would be abandoned as noisy within a week; this
  // mutant is what keeps the (table, column) pair discipline from being "simplified" away later. The tree
  // already contains two live instances of this shape (0041 creates review_states.moderation_status while
  // dropping reviews.moderation_status; 0038 adds service_credentials.expires_at while 0041 drops
  // confirmed_sales.expires_at) — this makes the property a mechanism instead of a coincidence.
  runMutant('M6-same-name-other-table-must-stay-green', 0, ['GREEN'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '29990104_0096_selftest_other_table.sql'),
      '-- SELFTEST-M6 mutant: a burned NAME reused on an UNRELATED table is legitimate; must NOT red.\nALTER TABLE users ADD COLUMN IF NOT EXISTS name_ru VARCHAR(100);\nALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20);\n');
  });

  // M7 — the TABLE-level axis (R6): a later migration re-creates a table an earlier one drops.
  runMutant('M7-table-level-drop-then-recreate', 1, ['whole table', 'R6'], (d) => {
    // The DROP must carry the LOWER migration number and the CREATE the higher one — that is the
    // dangerous direction. (Writing it the other way round is the HEALTHY case, and this mutant caught
    // exactly that mistake when it was first written: the gate stayed green and was right to.)
    fs.writeFileSync(path.join(d, 'migrations', '29990105_0094_selftest_droptable.sql'),
      '-- SELFTEST-M7 mutant\nDROP TABLE IF EXISTS selftest_cache;\n');
    fs.writeFileSync(path.join(d, 'migrations', '29990106_0095_selftest_recreate.sql'),
      '-- SELFTEST-M7 mutant\nCREATE TABLE IF NOT EXISTS selftest_cache (id serial PRIMARY KEY, payload text);\n');
  });

  // M8 — the RENAME BAN (R8). A bare `RENAME COLUMN` must RED with the ruling and the recipe, and the OLD
  // name must land in D — a ban that reds but does not burn the old name would be half a rule (the next
  // person could still pick that name and the gate would say nothing). A fictional column is used so this
  // mutant isolates ONE axis: renaming a REAL column additionally trips R1 (the canon still creates it),
  // which is the burn working as designed but would make the needles ambiguous about WHY it red-ed.
  runMutant('M8-bare-rename-column-is-banned', 1, ['R8', 'listings.selftest_probe', 'PRESCRIBED FORM', 'dropped by 29990107_0093_selftest_rename_col.sql'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '29990107_0093_selftest_rename_col.sql'),
      '-- SELFTEST-M8 mutant\nALTER TABLE listings RENAME COLUMN selftest_probe TO selftest_probe_v2;\n');
  });

  // M9 — the PREMISE ASSERT. The gate is handed a provision.ts in which the replay loop has been wrapped
  // in `if (!schemaPresent) { … }` — i.e. the replay is no longer unconditional. It must exit 2 saying its
  // premise changed: NOT 0 (a gate whose foundation moved must never stay green) and NOT 1 (a changed
  // premise is not a schema defect; a RED would send someone to rename a column in the wrong file).
  runMutant('M9-replay-made-conditional-premise-assert', 2, ['PREMISE CHANGED', 'if (!schemaPresent)'], (d) => {
    const raw = fs.readFileSync(PROVISION, 'utf8');
    const code = blankTs(raw);
    // provision.ts contains TWO `for (const … of migrations)` loops: the filename-ordering ASSERT and the
    // actual replay. Written naively (first match) this mutant wrapped the ORDERING loop, the gate stayed
    // GREEN — correctly, since the replay was untouched — and the mutant reported itself FAILED. Kept as a
    // note because it is the failure mode of mutation testing itself: a mutant that does not mutate the
    // thing under test looks exactly like a blind gate.
    const loops = [];
    const re = /for\s*\(\s*const\s+\w+\s+of\s+migrations\s*\)\s*\{/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(code, open);
      if (close === -1) continue;
      const body = code.slice(open, close);
      if (/\.query\s*\(/.test(body) && /readFileSync\s*\(/.test(body)) loops.push({ start: m.index, close });
    }
    if (loops.length !== 1) throw new Error(`self-test found ${loops.length} replay loops in provision.ts (expected exactly 1) — fix the self-test, do not weaken the assert`);
    const p = path.join(d, 'provision-mutant.ts');
    fs.writeFileSync(p, `${raw.slice(0, loops[0].start)}if (!schemaPresent) { ${raw.slice(loops[0].start, loops[0].close + 1)} }${raw.slice(loops[0].close + 1)}`);
    return { DROPPED_NAME_PROVISION: p };
  });

  // M10 — the table half of the same ban (R9). Fictional table name, so no other rule can also fire.
  runMutant('M10-bare-rename-table-is-banned', 1, ['R9', 'selftest_cache_old', 'PRESCRIBED FORM'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '29990108_0092_selftest_rename_table.sql'),
      '-- SELFTEST-M10 mutant\nALTER TABLE selftest_cache_old RENAME TO selftest_cache_new;\n');
  });

  // M11 — REPLAY ORDER. A file whose date prefix sorts EARLY while its number is HIGH makes byte-
  // lexicographic order (what provisioning actually replays in) disagree with numeric order (what this
  // gate compares). Every "earlier drop, later add" verdict would then be about an order that never
  // happens. The gate must refuse to measure (exit 2) rather than compare the wrong sequence.
  runMutant('M11-replay-order-ambiguous', 2, ['replay ORDER is ambiguous', '19990101_0093'], (d) => {
    fs.writeFileSync(path.join(d, 'migrations', '19990101_0093_selftest_out_of_order.sql'),
      '-- SELFTEST-M11 mutant: sorts FIRST by filename, numbered LAST\nSELECT 1;\n');
  });

  console.log('');
  if (failed) { console.log('::error::SELF-TEST: at least one mutant did not produce the required RED — this gate cannot be trusted until it does.'); process.exit(1); }
  console.log(`→ SELF-TEST: all ${ran} mutants behaved exactly as required — ${byCode[1]} forced RED (exit 1), ${byCode[2]} forced LOUD-INCONCLUSIVE (exit 2), ${byCode[0]} forced GREEN (anti-false-RED control).`);
  process.exit(0);
}

// ── PREMISE FIRST: verify the foundation before measuring anything on top of it ──────────────────
const premise = checkPremise();
if (premise.fails.length) {
  const msgs = ['', '::error::GATE PREMISE CHANGED — «моя предпосылка изменилась». PREMISE CHANGED: this gate no longer'];
  msgs.push('   describes the system it is pointed at, so it refuses to render ANY verdict — green or red.');
  msgs.push('');
  msgs.push('   WHAT THIS GATE ASSUMES: backend/src/provision.ts replays EVERY migration on EVERY start,');
  msgs.push('   UNCONDITIONALLY. That is the ONLY reason a `DROP COLUMN` from 2026-06 is still a LIVE statement');
  msgs.push('   today, and therefore the only reason reusing a dropped NAME destroys data. Take that away and');
  msgs.push('   a drop becomes a historical event again — and this gate silently degrades into a naming police');
  msgs.push('   that blocks legitimate work for a hazard that no longer exists. A premise that does not check');
  msgs.push('   itself is the same mine, only inside the instrument.');
  msgs.push('');
  msgs.push(`   CHECKED: ${PROVISION}`);
  msgs.push('   UNPROVEN:');
  for (const f of premise.fails) msgs.push(`     · ${f}`);
  msgs.push('');
  msgs.push('   WHY EXIT 2 AND NOT 1: this is not a defect in the schema, so "fix the column name" is the wrong');
  msgs.push('   remedy and a RED here would send someone to the wrong file. WHY NOT 0: a gate whose foundation');
  msgs.push('   moved and stayed green is worse than no gate — it certifies a property it can no longer test.');
  msgs.push('');
  msgs.push('   TO RESOLVE, pick one — deliberately:');
  msgs.push('     1. The replay is still meant to be unconditional → the change to provision.ts is the bug. Restore it.');
  msgs.push('     2. The replay is deliberately no longer unconditional → this gate\'s RULES must be re-derived');
  msgs.push('        (with the architect, as an ADR), not merely re-pointed. Then update this assert to match the');
  msgs.push('        new premise, and say so in the ADR: the migration-drift job and scripts/check-provision-heals-');
  msgs.push('        stale-db.sh rest on the same fact and must be re-decided together.');
  die(2, msgs);
}
console.log('');
console.log(`→ PREMISE VERIFIED (structurally, not by grep): ${path.relative(REPO, PROVISION) || PROVISION} replays the WHOLE`);
console.log(`   migration set UNCONDITIONALLY — loop at line ${premise.provisionLine}, enclosed by nothing conditional, list not sliced,`);
console.log('   no early return before it, no `continue` inside it, main() called at top level. Every rule below');
console.log('   is true ONLY because of that fact, so the gate re-proves it on every run instead of assuming it.');
for (const n of premise.notes) {
  console.log(`   NOTE: ${n}`);
  console.log('   The exact line to add (in provision.ts\'s header comment, so a human editing that file sees it):');
  console.log('     * GATE-CONTRACT: MIGRATION_REPLAY=UNCONDITIONAL — asserted by scripts/check-dropped-column-reuse.js');
  console.log('     *   (the dropped-name gate). Making this replay conditional invalidates that gate\'s rules: change');
  console.log('     *   both together, via an ADR. The gate also fails LOUD (exit 2) if this marker says anything else.');
}

// ── read inputs ─────────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(CANON) || fs.statSync(CANON).size === 0) {
  die(2, [`::error::canonical schema missing or empty at ${CANON} — fix the extractor / the inputs; refusing to report a verdict.`]);
}
let migFiles;
try {
  migFiles = fs.readdirSync(MIGDIR).filter((f) => f.endsWith('.sql')).sort();
} catch (e) {
  die(2, [`::error::cannot read the migrations directory ${MIGDIR}: ${e.message} — fix the extractor / the inputs.`]);
}

const problems = [];
const allEvents = [];

// canon
{
  const r = extract(fs.readFileSync(CANON, 'utf8'), 'database_schema.sql');
  for (const e of r.events) { e.order = -1; e.origin = 'canon'; allEvents.push(e); }
  problems.push(...r.problems);
}
// migrations
// `migFiles` is sorted BYTE-LEXICOGRAPHICALLY — identical to provisioning's `readdirSync().sort()` and to
// the CI `for f in migrations/*.sql` glob, i.e. this IS the real replay order. Every rule below then
// compares the 4-digit NUMBER instead, which is only valid while the two orders agree. provision.ts
// asserts that invariant at runtime, but this gate re-derives it here on purpose: a static verdict must
// not rest on an assert in another file that a future edit could delete (that assert loop is even the
// decoy that mutant M9 wrapped by mistake). If they disagree, the gate cannot know the replay order and
// says so — it does not compare a sequence that never happens.
const seen = new Map();
let prevNum = 0;
let prevFile = '(start)';
for (const f of migFiles) {
  const m = NAME_RE.exec(f);
  if (!m) {
    problems.push({ severity: 'abort', file: f, line: 0, msg: `migration filename does not match YYYYMMDD_NNNN_*.sql — the gate cannot know its replay ORDER, and order is the whole question here.` });
    continue;
  }
  const num = parseInt(m[2], 10);
  if (num <= prevNum) {
    problems.push({ severity: 'abort', file: f, line: 0, msg: `replay ORDER is ambiguous: ${f} (#${m[2]}) sorts AFTER ${prevFile} (#${String(prevNum).padStart(4, '0')}) by FILENAME but carries a lower-or-equal NUMBER. Provisioning replays in byte-lexicographic filename order while this gate compares numbers, so when the two disagree every "earlier drop / later add" verdict is about an order that never happens. Rename so the date prefix ascends with the number.` });
  }
  prevNum = num;
  prevFile = f;
  if (seen.has(num)) {
    problems.push({ severity: 'abort', file: f, line: 0, msg: `duplicate migration number ${m[2]} (also ${seen.get(num)}) — replay order is ambiguous.` });
  }
  seen.set(num, f);
  const r = extract(fs.readFileSync(path.join(MIGDIR, f), 'utf8'), f);
  for (const e of r.events) { e.order = num; e.origin = 'migration'; allEvents.push(e); }
  problems.push(...r.problems);
}

// ── build D and A ───────────────────────────────────────────────────────────────────────────────
const key = (e) => `${e.table}.${e.column}`;
const drops = allEvents.filter((e) => e.kind === 'drop' && e.origin === 'migration');
const creations = allEvents.filter((e) => e.kind === 'add' || e.kind === 'create_table');
const canonCreations = creations.filter((e) => e.origin === 'canon');
const migCreations = creations.filter((e) => e.origin === 'migration');

const D = new Map();
for (const d of drops) {
  if (!D.has(key(d))) D.set(key(d), []);
  D.get(key(d)).push(d);
}

// ── FLOORS (F1/F2/F3/F4) — refuse to report a verdict over nothing ──────────────────────────────
const aborts = problems.filter((p) => p.severity === 'abort');
const floorErrors = [];
if (migFiles.length < FLOOR.migrationFiles) floorErrors.push(`only ${migFiles.length} migration files found, floor is ${FLOOR.migrationFiles}`);
if (drops.length < FLOOR.dropEvents) floorErrors.push(`only ${drops.length} column-DROP events extracted, floor is ${FLOOR.dropEvents}`);
if (canonCreations.length < FLOOR.canonColumns) floorErrors.push(`only ${canonCreations.length} canon column creations extracted, floor is ${FLOOR.canonColumns}`);
if (migCreations.length < FLOOR.migrationCreations) floorErrors.push(`only ${migCreations.length} migration column creations extracted, floor is ${FLOOR.migrationCreations}`);
const canonTables = new Set(allEvents.filter((e) => e.origin === 'canon' && e.kind === 'create_table').map((e) => e.table));
if (canonTables.size < FLOOR.canonTables) floorErrors.push(`only ${canonTables.size} tables found in the canon, floor is ${FLOOR.canonTables}`);

MEASURED.text = `${migFiles.length} migrations · ${drops.length} column drops · ${canonCreations.length} canon columns · ${migCreations.length} migration columns · ${canonTables.size} canon tables`;

const inSet = (which, t, c) => {
  if (which === 'D') return D.has(`${t}.${c}`);
  const pool = which === 'A_canon' ? canonCreations : migCreations;
  return pool.some((e) => e.table === t && e.column === c);
};
for (const s of SENTINELS) {
  if (!inSet(s.set, s.table, s.column)) {
    floorErrors.push(`SENTINEL MISS — ${s.table}.${s.column} was not found in ${s.set}. It proves the parsing path: ${s.why}`);
  }
}

if (aborts.length || floorErrors.length) {
  const msgs = ['', '::error::GATE INCONCLUSIVE — fix the extractor. It refuses to report a verdict it cannot back up.'];
  msgs.push('   A gate that parses nothing prints "GREEN — 0 ∩ 0" and looks identical to a healthy tree. That is');
  msgs.push('   the false-green failure mode; these floors exist so it cannot happen silently.');
  if (floorErrors.length) {
    msgs.push('');
    msgs.push('   FLOOR MISSES:');
    for (const f of floorErrors) msgs.push(`     · ${f}`);
  }
  if (aborts.length) {
    msgs.push('');
    msgs.push('   UNCLASSIFIED / UNRESOLVED DDL (each one is a place the gate could be blind):');
    for (const a of aborts.slice(0, 40)) msgs.push(`     · ${a.file}:${a.line} — ${a.msg}`);
    if (aborts.length > 40) msgs.push(`     · … and ${aborts.length - 40} more`);
  }
  msgs.push('');
  msgs.push(`   measured: ${migFiles.length} migrations · ${drops.length} drops · ${canonCreations.length} canon creations · ${migCreations.length} migration creations · ${canonTables.size} canon tables`);
  die(2, msgs);
}

// ── THE INTERSECTION ────────────────────────────────────────────────────────────────────────────
// R1 canon creates a name a migration drops   → fresh install diverges from canon on the first `up`
// R2 a LATER migration ADDs it                → replay wipes the data and recreates the column EMPTY
// R3 a LATER migration CREATE TABLEs it       → replay wipes it and IF NOT EXISTS does NOT recreate it
// R4 the SAME file drops it, then re-adds it  → every replay wipes and recreates it EMPTY
// R8 a migration RENAMEs a COLUMN             → banned outright (two events + not replay-idempotent)
// R9 a migration RENAMEs a TABLE              → the same ban, one level up
const findings = [];

// ── the RENAME ban (R8/R9) — a finding on SIGHT, not an intersection ────────────────────────────
// Not filtered by origin: a RENAME in the canon is just as banned (it burns a name in the file that is
// supposed to BE the current shape), and the file:line in the finding says where it is either way.
const renames = allEvents.filter((e) => e.kind === 'rename');
for (const r of renames) {
  findings.push({
    rule: r.scope === 'table' ? 'R9' : 'R8',
    key: r.scope === 'table' ? `${r.table} → ${r.newName} (whole table)` : `${r.table}.${r.column} → ${r.table}.${r.newName}`,
    rename: r,
  });
}

// ── table-level axis (R5/R6/R7): a dropped TABLE name reused by a later CREATE TABLE ────────────
const tableDrops = allEvents.filter((e) => e.kind === 'drop_table' && e.origin === 'migration');
const tableCreates = allEvents.filter((e) => e.kind === 'create_table');
const firstCreatePerTable = new Map();  // one entry per (origin,file,table) — CREATE TABLE lists many columns
for (const c of tableCreates) {
  const k = `${c.origin}|${c.file}|${c.table}`;
  if (!firstCreatePerTable.has(k)) firstCreatePerTable.set(k, c);
}
for (const d of tableDrops) {
  for (const c of firstCreatePerTable.values()) {
    if (c.table !== d.table) continue;
    if (c.origin === 'canon') { findings.push({ rule: 'R5', key: `${d.table} (whole table)`, creation: c, drop: d }); continue; }
    if (c.order > d.order) { findings.push({ rule: 'R6', key: `${d.table} (whole table)`, creation: c, drop: d }); continue; }
    if (c.order === d.order && c.seq > d.seq) { findings.push({ rule: 'R7', key: `${d.table} (whole table)`, creation: c, drop: d }); }
  }
}
for (const [k, dropEvents] of D) {
  const [table, column] = [dropEvents[0].table, dropEvents[0].column];
  const minDrop = Math.min(...dropEvents.map((d) => d.order));
  const maxDrop = Math.max(...dropEvents.map((d) => d.order));

  for (const c of canonCreations) {
    if (c.table === table && c.column === column) {
      findings.push({ rule: 'R1', key: k, creation: c, drop: dropEvents.find((d) => d.order === minDrop) });
    }
  }
  for (const c of migCreations) {
    if (c.table !== table || c.column !== column) continue;
    const later = dropEvents.filter((d) => d.order < c.order);
    if (later.length) {
      findings.push({ rule: c.kind === 'create_table' ? 'R3' : 'R2', key: k, creation: c, drop: later[later.length - 1] });
      continue;
    }
    const sameFile = dropEvents.filter((d) => d.order === c.order && d.seq < c.seq);
    if (sameFile.length) {
      findings.push({ rule: 'R4', key: k, creation: c, drop: sameFile[sameFile.length - 1] });
    }
  }
  void maxDrop;
}

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────────
const fileOf = (num) => seen.get(num) || `#${num}`;
say('');
say('── D: the BURNED (table, column) names — a migration drops each of these on EVERY provisioning run ──');
say('   These names must never be reintroduced. Reusing one is not a naming clash: it is silent data loss.');
say('');
const rows = [...D.entries()].sort();
// `--dump`: the burned-name registry as TSV, so docs/tooling can consume it instead of re-deriving it
// (a second derivation is a second chance to be wrong). Columns: table, column, dropped_by, created_by.
if (process.argv.includes('--dump')) {
  console.log('# table\tcolumn\tdropped_by\tcreated_by');
  for (const [k, evs] of rows) {
    const prov = creations.filter((c) => `${c.table}.${c.column}` === k)
      .map((c) => (c.origin === 'canon' ? 'canon' : String(c.order).padStart(4, '0')) + `/${c.kind === 'create_table' ? 'CREATE_TABLE' : 'ADD_COLUMN'}`);
    console.log(`${evs[0].table}\t${evs[0].column}\t${evs.map((e) => `${e.file}:${e.line}`).join(';')}\t${prov.length ? prov.join(';') : 'ORPHAN'}`);
  }
}
for (const [k, evs] of rows) {
  const provenance = creations.filter((c) => `${c.table}.${c.column}` === k)
    .map((c) => (c.origin === 'canon' ? 'canon' : `${String(c.order).padStart(4, '0')}`) + `/${c.kind === 'create_table' ? 'CREATE TABLE' : 'ADD COLUMN'}`);
  const dropsTxt = evs.map((e) => `${e.file}:${e.line}`).join(', ');
  say(`   ${k.padEnd(46)} dropped by ${dropsTxt}`);
  say(`   ${''.padEnd(46)} created by: ${provenance.length ? provenance.join(', ') : 'NOWHERE in the tree — an ORPHAN drop (highest reuse risk: nothing in the schema hints the name is burned)'}`);
}
say('');
say(`   D = ${rows.length} burned pairs · A = ${canonCreations.length} canon creations + ${migCreations.length} migration creations`);
const notes = problems.filter((p) => p.severity === 'note');
if (notes.length) {
  say('');
  say('   Reported-not-counted (visible on purpose):');
  for (const n of notes.slice(0, 10)) say(`     · ${n.file}:${n.line} — ${n.msg}`);
  if (notes.length > 10) say(`     · … and ${notes.length - 10} more`);
}

if (!findings.length) {
  say('');
  say(`✓ GREEN — D ∩ A = ∅. None of the ${rows.length} burned names is created by the canon or by any later migration.`);
  say(`  Measured over ${migFiles.length} migrations + the canon: ${drops.length} drop events, ${creations.length} creation events, 0 unclassified.`);
  coverage();
  process.exit(0);
}

const explain = {
  R1: 'the CANON creates this column, and a migration DROPS it. Provisioning applies the canon FIRST and then\n     replays every migration, so a fresh install loses the column immediately — and on every `up` after that.',
  R2: 'a LATER migration re-adds this column with ADD COLUMN. On the next provisioning run the EARLIER drop kills\n     the populated column and the later ADD recreates it EMPTY. The schema still looks perfect: right table, right\n     column, right type — the drift gate stays green. Only the DATA is gone, silently, on every restart, and there\n     is no fossil left to prove it happened.',
  R3: 'a LATER migration creates this column inside a CREATE TABLE. Because that CREATE TABLE is IF-NOT-EXISTS-shaped,\n     the earlier DROP wipes the column on replay and the CREATE TABLE does NOT bring it back — the column vanishes\n     from the schema entirely and the two bootstrap paths diverge.',
  R4: 'the SAME migration drops this column and then re-adds it further down the file. Every provisioning run wipes\n     it and recreates it EMPTY. Deterministic, idempotent-LOOKING, and destructive.',
  R5: 'the CANON creates this TABLE and a migration DROPS it. Provisioning applies the canon first, so a fresh\n     install loses the whole table on its very first `up`.',
  R6: 'a LATER migration re-creates this TABLE after an earlier migration drops it. Every provisioning replay\n     therefore destroys the table and rebuilds it EMPTY — the column-level mine, one level up, with every row\n     gone instead of one column.',
  R7: 'the SAME migration drops this TABLE and re-creates it further down the file. Every provisioning run wipes\n     every row and rebuilds the table empty.',
  R8: 'A BARE `RENAME COLUMN` IS FORBIDDEN IN A MIGRATION (holder ruling, 2026-08-08). Two independent reasons,\n     both fatal:\n     (1) IT IS NOT IDEMPOTENT under the unconditional replay. The second replay of this file finds no column\n     under the OLD name and the whole provisioning run dies — on a live stack `api` and `worker` never start,\n     because they gate on the provisioner. And the "obvious" fix — wrapping the rename in an existence guard —\n     is WORSE, not better: it goes quiet, and then nothing anywhere records that the old name is gone.\n     (2) IT IS TWO EVENTS IN ONE STATEMENT: the old name is BURNED and a new name is INTRODUCED. Nobody\n     reading this line later sees a burn, so the old name stays available to the next person who needs a\n     good name — and reusing it is precisely the silent data loss this whole gate exists to prevent.',
  R9: 'A BARE `RENAME TO` (whole table) IS FORBIDDEN IN A MIGRATION — the same ruling, one level up, and the same\n     two reasons: not idempotent under the unconditional replay, and it burns the old TABLE name invisibly.\n     A later `CREATE TABLE <old name>` would then be rebuilt EMPTY on every single `up`.',
};
const RENAME_RECIPE = {
  R8: [
    'PRESCRIBED FORM — the only allowed way to rename a column. Three separate statements, each guarded by',
    'EXISTENCE, so each one is replay-idempotent on its own and the burn is written down explicitly:',
    '  1.  ALTER TABLE t ADD COLUMN IF NOT EXISTS <new> <type>;',
    '  2.  UPDATE t SET <new> = <old> WHERE <new> IS NULL AND <old> IS NOT NULL;   -- inside a DO block guarded',
    '      by  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=\'t\' AND column_name=\'<old>\')',
    '      …so that once step 3 has run, the backfill can never fire again (the 0018 idiom).',
    '  3.  ALTER TABLE t DROP COLUMN IF EXISTS <old>;',
    'Step 3 is what puts t.<old> into D — from then on THIS gate refuses any future reuse of that name, which',
    'is the half a rename silently skips. Steps 1-3 may live in one migration; the order inside the file matters.',
  ],
  R9: [
    'PRESCRIBED FORM — the only allowed way to rename a table:',
    '  1.  CREATE TABLE IF NOT EXISTS <new> (… the new shape …);',
    '  2.  INSERT INTO <new> SELECT … FROM <old> ON CONFLICT DO NOTHING;   -- guarded by to_regclass(\'<old>\')',
    '      IS NOT NULL, inside a DO block, so it cannot fire once step 3 has run.',
    '  3.  DROP TABLE IF EXISTS <old>;   -- explicit burn: this gate then records <old> and locks the name',
    'Views, FKs and indexes pointing at <old> must be re-pointed in the same migration — which is the other',
    'reason a rename "for free" is a fiction: `RENAME TO` hides that work instead of removing it.',
  ],
};
say('');
const reuseFindings = findings.filter((f) => !f.rename);
const renameFindings = findings.filter((f) => f.rename);
say('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
if (reuseFindings.length && renameFindings.length) {
  say('║ RED — a BURNED NAME is being reused AND a FORBIDDEN RENAME is present. Both destroy data.      ║');
} else if (renameFindings.length) {
  say('║ RED — A FORBIDDEN RENAME IS PRESENT IN THE MIGRATION SET. See the prescribed form below.       ║');
} else {
  say('║ RED — A BURNED COLUMN NAME IS BEING REUSED. Provisioning would silently destroy this data.     ║');
}
say('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');
for (const f of findings) {
  if (f.rename) {
    say('');
    say(`  ${f.rule}  ${f.key}`);
    say(`      RENAME at  : ${f.rename.file}:${f.rename.line}   [${f.rename.form}]`);
    say(`      BURNED NAME: ${f.rename.scope === 'table' ? f.rename.table : `${f.rename.table}.${f.rename.column}`}  — recorded in D by this gate, so it can never be reused later.`);
    say('      WHY THIS IS FORBIDDEN:');
    for (const l of explain[f.rule].split('\n')) say(`        ${l.trim()}`);
    say('      ' + RENAME_RECIPE[f.rule][0]);
    for (const l of RENAME_RECIPE[f.rule].slice(1)) say(`        ${l}`);
    continue;
  }
  const creator = f.creation.origin === 'canon'
    ? `database_schema.sql:${f.creation.line}  (the canon — applied FIRST, before any migration)`
    : `${f.creation.file}:${f.creation.line}  (migration ${String(f.creation.order).padStart(4, '0')})`;
  say('');
  say(`  ${f.rule}  ${f.key}`);
  say(`      DROPPED by : ${f.drop.file}:${f.drop.line}  (migration ${String(f.drop.order).padStart(4, '0')})`);
  say(`      CREATED by : ${creator}  [${f.creation.form}]`);
  say('      WHY THIS IS DANGEROUS:');
  for (const l of explain[f.rule].split('\n')) say(`        ${l.trim()}`);
  if (/^RENAME/.test(f.drop.form)) {
    say('        NOTE: the "drop" above is a RENAME — the data survives under the NEW name, but the OLD name is');
    say('        burned all the same, so re-creating it later gives you an EMPTY column/table on every replay.');
    say('        The rename itself is separately forbidden (R8/R9); fix that first and this finding goes with it.');
  }
}
if (renameFindings.length) {
  say('');
  say(`  THE RENAME BAN, IN ONE LINE: a migration may ADD a name and a migration may DROP a name — it may not do`);
  say('  both in one statement. Renames in this tree today: 0 (before this finding). The rule was introduced at');
  say('  zero cost on purpose; every rename that lands before the rule makes the rule more expensive, never less.');
}
if (!reuseFindings.length) { coverage(); process.exit(1); }
say('');
say('  WHAT TO DO (pick one, deliberately):');
say('   1. USE A DIFFERENT NAME. Cheapest and safest. Precedent in this tree: migration 0041 dropped');
say('      `reviews.superseded_by_id` and the replacement pointer was named `supersedes_review_id`, not');
say('      reused. Do the same.');
say('   2. If the name MUST come back, first land a NEW migration (higher number than the dropping one)');
say('      that makes the old DROP conditional — e.g. wrap it so it only fires while the column is still');
say('      the OLD one (check its type/comment/a marker), or drop the drop. Do NOT edit the applied');
say('      migration: ADR-0007 makes migrations immutable; its effect is superseded by a new migration,');
say('      the way migration 0042 supersedes 0007.');
say('   3. Never "guard the drop by whether a later migration adds it". A migration cannot know the');
say('      future; such a guard is a claim written before the fact it checks exists.');
say('');
say('  Context: provisioning replays ALL migrations unconditionally on every start (backend/src/provision.ts');
say('  step 2). That is deliberate — it is what heals a stale volume — so every DROP in the set is a live');
say('  statement forever, not a historical event.');
coverage();
process.exit(1);
