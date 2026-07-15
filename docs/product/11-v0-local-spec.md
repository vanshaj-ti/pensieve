# v0 Spec — Local-First Pipeline (Claude Code only)

Status: draft, pending confirmation before implementation starts.

## Scope

- Source: Claude Code session transcripts only. No Cursor, no other tools. v0 non-goal.
- Output: local files only — SQLite DB + daily markdown briefs. No UI, no dashboard, no server.
- Team/hosted sync: explicitly out of scope for v0. Speced separately later, once local tool is proven useful solo.

## 1. Data Source

```
~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl
```

- One directory per project (path with `/` replaced by `-`), one file per session.
- JSONL, one JSON object per line. Relevant line `type`s: `user`, `assistant` (real content); everything else (`attachment`, `mode`, `permission-mode`, `queue-operation`, `system`, `file-history-*`, `ai-title`) is noise, dropped at ingestion.
- Every line carries its own `.timestamp`, `.cwd`, `.gitBranch`, `.sessionId` — used for day-bucketing and episode chunking without needing extra bookkeeping.
- Sessions can be long-lived (devs continue one chat across days/weeks via compaction) — files are NOT bounded to a single day or a single unit of work. Handled by cursor + chunking below, not by any assumption about file size.

## 2. Cursor / Dedup

- SQLite table `sessions(project_dir, session_id, last_line, last_run_at)`.
- Each run: cheap `mtime` check first to skip untouched files. For touched files, read only lines after `last_line`.
- Cursor advances only after the full pipeline (extraction → verification → storage) succeeds for that slice — failure mid-run does not advance the cursor, so a retry reprocesses the same range (idempotent, no silent data loss).
- `--force` flag bypasses cursor for manual backfill/reprocessing. Never the default.

## 3. Day Bucketing

- Calendar day, local timezone.
- Bucketed per-line by that line's own `.timestamp`, not by file or by cron-run time — a session spanning midnight naturally splits its lines into two days.

## 4. Episode Chunking

Within a given day's new lines, per session:

- **Idle-gap split**: new episode starts when the gap between consecutive lines exceeds a threshold. Configurable (config file / CLI flag), default 25 min.
- **Compaction-boundary split**: a compaction event in the log forces a hard episode boundary regardless of gap.
- No topic-modeling, no cwd/branch-change detection in v0 — these two rules are cheap, timestamp-based, and sufficient for a first cut.

## 5. Extraction Pipeline (generator / verifier split)

### Pass 1 — Haiku 4.5, per episode
- Input: one episode's filtered text turns + relevant tool_use/tool_result summaries (kept, not stripped — this is where real signal lives: which file changed, what command ran, what failed).
- Output (forced structured/tool-call schema, not free-text JSON): a list of **candidate** moments, each with an evidence pointer (line ref + exact quoted snippet) and a rough category tag.
- Deliberately high-recall / over-inclusive. False positives are cheap to filter in pass 2; false negatives are permanent misses.
- Batched via Anthropic Message Batches API (50% off) since nothing here is real-time. System-prompt portion cached (prompt caching, ~90% off repeated prefix).

### Pass 2 — Sonnet, once per day, batched across all episodes
- Input: all of today's Haiku candidates (evidence snippets, not raw episode text) + recent history pulled from SQLite (for recurrence comparison, see §6).
- Job: reject unsupported/generic candidates, merge duplicates, score significance, write the final polished insight sentence, flag recurrence ("seen N days this week").
- Rejection basis: if the evidence snippet doesn't actually support the claim, discard — this is the hallucination check.

### Pass 3 — Git-outcome correlation — CUT FROM v0, fast-follow candidate
- Deferred. Original idea: corroborate each Sonnet-approved insight against actual git log/diff in the timestamp window, to distinguish "AI said this sounded like a good decision" from "this actually happened and stuck."
- Cut for v0 to keep build scope tight and ship the simpler Haiku→Sonnet→brief pipeline first. Sonnet's evidence-snippet grounding (§ Pass 2 rejection basis) is the trust mechanism for v0 instead.
- Schema keeps `verified_by_git` / `recurrence_of` fields reserved (see §7) so this can be added later without a migration, if the ungrounded brief turns out not to be trustworthy enough on its own.

## 6. Recurrence Detection

- Each stored insight gets embedded via Google Gemini embedding API (`text-embedding-004` or current equivalent) — separate vendor/key from the Haiku/Sonnet extraction calls, but same pattern: one more API call, no local ML setup needed.
- `sqlite-vec` extension provides ANN similarity search directly inside the same SQLite file — no separate vector DB / no extra infra.
- New insight compared against recent stored insights; similarity above threshold → tagged as recurrence of an existing pattern instead of re-asking Sonnet to "remember" via prompt stuffing.
- Keeps cost and prompt size flat regardless of how much history has accumulated.

## 7. Storage

SQLite, single file: `~/.pensieve/pensieve.db`

```
sessions(project_dir, session_id, last_line, last_run_at)
episodes(id, date, project_dir, session_id, start_line, end_line)
insights(id, episode_id, category, text, evidence_ref, significance_score,
         verified_by_git BOOLEAN, recurrence_of INTEGER NULL, created_at)
```

- Schema validated (zod/pydantic, per implementation language) before any write — malformed model output never reaches the DB.

## 8. Output

- One markdown file per day: `~/.pensieve/briefs/YYYY-MM-DD.md`.
- Grouped by category (mirrors the six telemetry categories from `03-telemetry-categories.md`), pulled from SQLite for that date.
- Verified (git-corroborated) insights visually distinguished from unverified ones.

## 9. Trigger

- Primary: daily cron job running `pensieve analyze`.
- Optional, opt-in: Claude Code Stop hook calls the same command immediately when a session ends — shares the identical cursor/dedup path, so no special-casing, just an earlier nudge. Cron remains the backstop for anything the hook misses (closed laptop, disabled hook, etc).

## 10. Explicit Non-Goals (v0)

- No ingestion from Cursor or any tool other than Claude Code.
- No hosted backend, no team view, no multi-tenant auth.
- No UI/dashboard — SQLite + markdown files only. A viewer can be a thin later layer reading the same DB.
- No cross-user/aggregate analytics.

## Decisions Locked

1. **Implementation language/runtime: TypeScript (Node).** Chosen with an eye on a future dashboard/UI reusing the same stack (shared types, one language across CLI + web later). Ecosystem support: `better-sqlite3`, `sqlite-vec`, Anthropic SDK, Voyage SDK all solid.
2. **Embedding provider: Google Gemini embedding API.** Extraction (Haiku/Sonnet) stays on Anthropic; embeddings use a separate Gemini key. Two vendors, but no local ML setup needed either way.
3. **Idle-gap threshold: configurable, default 25 min.** Exposed via config file / CLI flag, tunable per user without code changes.
