# Handoff: harness comparisons (A/B) implementation

Internal implementation companion to the public design docs under
`apps/docs/src/content/docs/comparisons/` (Overview → Metrics split → Experiments
→ Diagnostics → Statistics → Publishing). **Read those first** — they are the
spec. This file holds the extra scaffolding that doesn't belong on the public
docs site: a research index so you don't re-explore, environment gotchas, the
validation assets, and a suggested build order. Delete it once the feature lands.

## Status / what's already done

- **Event-classification fix — committed (`19ba02de`).** Five third-party-harness
  tools were leaking to `unknown` (`apply_patch`, `background_process`, `task`,
  `search_codebase`, `agent_settled`). Fixed in `crates/core/src/event.rs` with
  regression tests in `crates/core/src/event.test.rs`. This was the prerequisite
  for the diagnostics layer (tool-call counts are only trustworthy once
  classification is). Details in `comparisons/diagnostics.md`.
- **The design docs — this commit.** Nothing else is implemented yet.

## Two data gaps confirmed IN SCOPE (owner decision)

Both are required, not optional (see `comparisons/diagnostics.md`):

1. **Tool-call counts including consumed tools.** Todo tools (`todowrite`/
   `todoread`, Goose `todo`) are deliberately consumed and emit no event — Kilo
   called `todowrite` 53× across 3 Carom runs. A tool-call view off the event
   stream alone would show zero. Count every invocation.
2. **Per-turn token attribution.** Raw streams carry per-turn usage (Pi
   `message_end`, Kilo/OpenCode `step_finish`) but `parse_session_usage`
   (`crates/core/src/harness_registry.rs`) sums it away. Add a per-turn usage
   `EventKind` variant and have each `parse_*` emit it.

## Research index (so you don't re-explore)

### Run data model — everything you need is already on the record
- `crates/core/src/run_record.rs`: `RunSubject` carries `harness_slug`
  (`HarnessSlug` enum; `Gg` excluded from `HarnessSlug::ALL`), `harness_version`,
  `orchestrator_slug` (default `one-shot`), `model_id`, and gg-only
  `gg_capability_set` / `gg_summary`.
- `crates/core/src/metrics.rs`: `RunMetrics { run_time_seconds, tokens, cost }`.
  `TokenCounts` = 4 `Option<u64>` classes (`uncached_input`, `cached_input`,
  `output`, `reasoning`; `None` ≠ `Some(0)`). `Cost { comparable, actual }` (USD,
  `Option<f64>`). **Use `comparable` for comparisons.**
- `crates/core/src/gg.rs`: `GgSessionSummary` (durable) has `slot_costs:
  Vec<GgSlotCost>` (per-slot `{slot, model_id, tokens, cost}`) — but **no**
  tool-call count. gg per-tool/per-turn detail lives only in the live
  `GgTelemetryKind` event stream (`ToolCall`, `ContextMessage`, `Usage`, …),
  aggregated on read by `ggToolBreakdown` in
  `packages/ui/src/app/pages/runs/gg/useGgRunState.ts`.
- `crates/entities/src/run.rs` (`run` table): lifts `harness_slug`, `model_id`,
  `cost_comparable`, `total_tokens`, `rating`, `review_count`, `published`,
  `published_at` as columns; the full record is in `record_json`.
  **`orchestrator_slug` is NOT lifted** (only in the JSON blob). The numeric
  score is NOT a column — derived from the sibling `review` table.

### Metric split (Layer 1) — the four merge spots
All client-side, all key on `canonicalModelId(modelId)` alone today:
1. `packages/ui/src/primitives/MetricChartWidget.tsx` — `meanBars()` / `runBars()`
2. `packages/ui/src/app/pages/testcases/[slug]/TestCaseMetricsPage.tsx` —
   `ratingModels`
3. `packages/ui/src/app/pages/testcases/[slug]/TestCaseLeaderboardPage.tsx` —
   `accs`
4. game-jam Metrics tab (reuses the same `MetricsContent`/widgets)

`canonicalModelId`: `packages/ui/src/modelId.ts` (TS) + `crates/core/src/model_id.rs`
(Rust). New key = `(harnessSlug, canonicalModelId(modelId))`; **keep the
canonicalization**; **filter gg out** of these graphs (multi-model, no single bar).

### Automated-only scoring
- Auto-verdicts: `record.validation.debugScripts[]` (`crates/core/src/validation.rs`):
  each `DebugScriptResult { item_id, sub_item_id?, gates, precondition_unmet,
  verdicts: [AutoVerdict{id, pass}] }`. Coverage set = verdict ids present in
  `debugScripts` (honor `gates`/`scored`, skip `precondition_unmet`).
- Score via existing `score_checklist` (Rust `crates/core/src/review.rs`) /
  `scoreChecklist` (TS `packages/ui/src/ratings.ts`) by synthesizing
  `ReviewVerdict`s from the auto-verdicts and restricting items to the covered ids.
- TS already has the conversion: `autoVerdictMap(run)` in
  `packages/ui/src/app/pages/runs/[runId]/RunReviewEditor.tsx`.
- The per-item "is automated" flag `ReviewItem.validation` is `#[serde(skip)]` —
  that's WHY coverage must come from per-run `debugScripts`, not the case's items.
- Existing `run_summary_score` (`crates/backend/src/snapshot.rs`) returns `None`
  with no reviews — the auto-only score is a NEW path.

### Triggering runs
- `NewRunPage` → `launchBatch()` (`packages/ui/src/app/pages/runs/launchBatch.ts`)
  → `POST /jobs/batch`. Already fans out harness × model combos × run count.
- gg uses its own `POST /gg/runs` (`launchGgRun`), not the batch endpoint.
- Coverage plans (`crates/backend/src/api/coverage.rs`,
  `crates/entities/src/coverage_plan.rs`; UI under
  `packages/ui/src/app/pages/account/`) are the closest "saved matrix + trigger
  missing" machinery — reuse, don't rebuild.

### Publish (Layer 3)
- Gate: `gate_publishable` (`crates/backend/src/db.rs`, ~line 1367). Already waives
  the review requirement for `publishable_failure_states` (catastrophic/timed_out/
  harness_error). Extend with an "auto-validated comparison run" predicate.
- Snapshot membership = `all_published()` (`db.rs`, `published = true` only).
- Publish is EXPENSIVE: per run = a `tcab-publisher` pod + GitHub repo + Cloudflare
  Pages deploy (`crates/publisher/src/publish.rs`). Batch = enqueue N publish jobs
  through the queue; make it selective and log what's left unpublished.
- Zero-review runs already render (`RunVerdictPage` "Results" mode; reviewer lists
  guarded on `reviews.length`). No public-UI work to show a review-less run.
- Comparison record: model on the **game-jam aggregate** (published into snapshot),
  NOT the **tournament** (live-only, never in snapshot). Wire new objects into
  `SnapshotBuilder::build` (`crates/backend/src/snapshot.rs`) +
  `apps/site/vite-plugin-snapshot.ts` + `apps/site/src/staticGallery.ts`.
- Internal-only create/run gate: `canExecute` on `GalleryDataInput`
  (`packages/ui/src/app/data/galleryContext.tsx`) — `true` via `useLiveGallery`
  (console/Tauri), `false` via `useStaticGallery` (static site).
- Aggregation contract precedent: gg's `crates/core/src/gg_aggregate.rs`
  (group-by-facet → avg/min/max/sum) — extend with dispersion stats.

## Environment gotchas (will bite you)

- **Cargo target is shared at `/cargo-target/the-test-cabinet/`**, not
  `./target`. Built binaries live under `/cargo-target/the-test-cabinet/debug/…`.
- **Use `cargo nextest run`, not `cargo test`** (enforced; see
  `.claude/skills/coding/SKILL.md`). Doctests only: `cargo test --workspace --doc`.
- **A pre-commit / command hook blocks any shell command containing the string
  `cargo test`** — it rejects the whole command before it runs. Don't put file
  writes in the same command as a `cargo test` invocation.
- **Docs build:** `cd apps/docs && npm run build` (Astro). A missing sidebar slug
  in `apps/docs/astro.config.mjs` fails the build; broken heading anchors do not.
- markdownlint/cspell pre-commit hooks are scoped to `test-cases/` and
  `game-jams/` only — they do NOT lint `apps/docs`.
- `make run-images` is needed if you change core run-container tooling (not
  relevant to this feature so far).

## Validating event classification (reference assets)

The 15 Carom runs used to validate the fix (owner-provided), pullable with
`scripts/extract-assets.sh <id>...` → `tmp/assets/<id>/` (`events.jsonl` =
translated, `raw.jsonl` = raw stream wrapped as `{stream, line}`):

- Codex: `91c17c1a-76e7-46d2-8cf8-333f65e4e023`,
  `26a88be1-b55a-4de9-8c2e-77e55773c7a3`, `6e8724da-6805-4023-95dc-672146aabe5a`
- OpenCode: `bb589847-7fcc-4329-b05f-ccef24816a7d`,
  `41266779-faf1-42ad-99fd-cd9a89609710`, `f1009b1d-a13c-4e33-9816-f04022a9492f`
- Cline: `c7add903-af3b-4c36-b688-03ef3abef6c0`,
  `b7520fd8-92b6-4c28-ac80-bfa67df0f6ac`, `f09f8c17-b492-4f30-ae22-96b521c2942d`
- Kilo: `98f88c73-103b-47c5-85bd-451ad272f254`,
  `781f4e7d-d432-4b9b-b4b5-5a4a4ad1dbcf`, `240e8400-4244-4980-9483-dd22f17c91e8`
- Pi: `a8c0188f-e7de-4485-a771-3fe5b19f1ee4`,
  `cb313669-2995-4fd5-8abb-4717702e5855`, `454cb312-a590-456d-acfc-99db24c9468b`

Re-validation technique: a throwaway example that drives the current
`EventParser` over each `raw.jsonl` (map `.stream`→`OutputStream`, feed `.line` to
`ingest`) and reports any event whose `type == "unknown"`, with a tool label.
Confirm **zero unknowns** across all 15. (The example was removed after use;
re-create it under `crates/core/examples/` if you need it again.)

## Suggested build order

1. **Metric split** — smallest, self-contained, ships to public immediately;
   satisfies the hard "don't merge harnesses" requirement. Four spots + gg filter.
2. **Diagnostics data capture** — the two in-scope gaps (tool-call counts,
   per-turn usage). Foundational for the comparison's "why," and independently
   useful on the existing run views.
3. **Comparison experiment** — the entity, auto-only scoring, triggering,
   per-arm aggregation + statistics (deterministic; seed any bootstrap from
   sorted run ids).
4. **Publishing** — gate waiver, batch publish through the queue, snapshot
   objects, static-site ingestion, `canExecute`-gated UI page.
