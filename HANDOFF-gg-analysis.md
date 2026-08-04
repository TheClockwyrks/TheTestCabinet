# Handoff: gg analysis (replay v2, playback, query language, code analysis)

Internal implementation companion to the public design docs under
`apps/docs/src/content/docs/gg/analysis/` (Overview → Replay records → Playback →
The query language → Code analysis). **Read those first** — they are the spec.
This file holds what does not belong on a public docs site: the reconciled
contract change set, the dependency graph, a numbered build order with
verification, the consolidated open questions and risk register, a research index
so you do not re-explore, and the environment gotchas. Delete it once the work
lands.

Verified against `rel/v0.7.0` at `4af242d9`. Every line number below was checked
at that commit — **re-grep before editing**, they drift.

## Status / what is already done

- **The design docs — this commit.** Nothing is implemented yet.
- Four separate designs were reconciled into one plan. Section 1 records every
  adjudication where two designs proposed different shapes for the same thing; the
  losing shape is **deleted from the plan**, not deferred.

---

## 1. Reconciled contract set

### 1.1 The aggregate query language: the document model wins outright

The query-language design **deletes** `GgFacet`, `GgMetric`, `GgSummaryField`,
`GgAggregateQuery`, `GgAggregateRow`, `aggregate()`, `param_scalar`, both
`gg_aggregate.rs` files, `POST /gg/aggregate`, the `gg-aggregate.ts` module and
three schema documents — replacing them with `GgRunDoc` (a flat dotted field map)
plus TCQ. The code-analysis design **extended** the same enums.

**Decision: the document model wins. The code-analysis query extension is deleted
from the plan.** Every piece of it is subsumed:

| Code-analysis proposed | Subsumed by | Cost |
| --- | --- | --- |
| `GgMetric::Code { path }` | any `code.*` document field | zero — the open-path idea is generalised |
| `GgFacet::Model {}` | the `model` field, from `RunSubject::model_id` | zero — both designs independently found this missing |
| `GgFacet::CodeLanguage {}` | `code.language` (derived scalar, see 1.4) | zero |
| `GgFacet::AnalyzerVersion {}` | `code.analyzerVersion` | zero |
| `GgFacet::CodeAuthoredBasis {}` / `CodeTreeBasis {}` | `code.authoredBasis` / `code.treeBasis` | zero |
| `GgAggregateQuery.include_truncated_code` | the filter clause `not code.notes.truncated` | better — composable, visible, no hidden default |
| `Copy` removal from four contract types | — | **avoided entirely**; those types cease to exist |

Consequence to plan around: **if code analysis ships before the query language,
its metrics are visible on the per-run Code tab and on `RunSummary` but are not
queryable.** That is acceptable and is why the milestone order is what it is.

### 1.2 Code-metric ingestion: typed struct, not an open bag

**`RunRecord.measurements: BTreeMap<String, f64>` is dropped before it exists.**
Reasons, in order:

1. The query design already concedes it: `flatten_json` over a typed block
   produces the same dotted keys a bag would, with no change to the query layer.
2. Three load-bearing code fields are **not `f64`**: `notes.truncated` (bool),
   `authoredBasis` / `treeBasis` / `languages` (enums). A bag forces a parallel
   typed block anyway.
3. The typed struct carries units, labels, families, polarity and `approximate`,
   which the Code tab and the field sidebar need.
4. A generic sink with exactly one producer is a typed field with extra steps.

**What changes for code analysis as a result:** under TCQ there is no metric
*picker* to populate from a generated Rust constant — the field sidebar derives
its catalog from observed documents. So `CODE_METRICS` shrinks from "the query
language's metric vocabulary" to **display metadata for the `code.*` namespace**
(label, unit, family, `higherIsBetter`, `approximate`). It still generates to
`packages/run-record/src/codeMetrics.ts`; the Code tab and the sidebar's label
lookup read it; the `catalog_paths_resolve` test still guards it. This is a
genuine simplification of code-analysis build step 2.

**Namespace is `code.*`, not `measure.*`.** One namespace, one source
(`RunRecord.code_analysis`).

### 1.3 The replay record: one format, three collisions settled

Replay and playback describe one format from two ends. Settled:

**(a) `formatVersion`, not `version`.** Replay's name (it says what it versions),
with playback's `#[serde(default)]` requirement adopted verbatim. **Absent ⇒ 1**,
not 0 — replay's `GgReplayRecordRaw` upgrade already normalises every legacy
record to format 1, so a second "pre-versioning" sentinel is a redundant code
path.

`PlaybackError::Unversioned` fires on **`GgReplayRecord::captured_before_v2()`**
(no fingerprints, no provenance) — *not* on `formatVersion < 2`. AMENDED IN M0
(commit `8817042a`), and the amendment is load-bearing for M8, which is the
milestone that consumes the predicate. Reading a v1 body **upgrades it to the v2
shape**, so the record in hand reports `formatVersion: 2`; what the *recorder*
wrote is carried separately on a new optional field, **`upgradedFrom`**, which
`captured_before_v2()` reads alongside `formatVersion`. The two have to be kept
apart or the record does not round-trip: a document that said `1` while carrying
pooled entries would be re-upgraded on the next read, and the upgrade's
positional re-interning would substitute pool indices for message bodies. See
`crates/core/src/gg_replay.rs` (the `format_version`/`upgraded_from` field docs
and the guard in `GgReplayRecordRaw`'s upgrade).

`upgradedFrom` is therefore part of the reconciled contract: `Option<u32>`,
`#[serde(default, skip_serializing_if = "Option::is_none")]`, absent on a record
captured at the current format version.

**(b) `GgTurnFingerprint` is a fold over pool ids, not a second hash.** Neither
design saw this. Under v2, `GgReplayMessage.id` and `GgReplayToolset.id` **are
already** SHA-256 content addresses computed by `fingerprint_exact` at intern
time. Redefine, carried on `GgReplayRequest`:

| Field | v2 definition |
| --- | --- |
| `system` | the pooled id of the first `system`-role message |
| `tools` | the toolset's pooled id, verbatim |
| `conversation` | SHA-256 over the ordered message-pool id strings |
| `messages` | `request.messages.len()` |
| ~~`ggVersion`~~ | **removed** — lives once on `GgReplayRecorder` |

This satisfies playback R2 as a *consequence* of pooling, and makes recorder-side
and playback-side computation trivially identical because both go through one
interning function. `sha2` (`Cargo.toml:288`) and `hex` (`:290`) are already
workspace deps.

**(c) Agent provenance is a top-level table, not per-entry fields.** Repeating a
five-field tuple on every entry defeats the pooling thesis. Add one block:

```rust
/// One agent the record captured, and how it came to exist — the table a driving
/// replay binds live agents through. One row per agent, not per turn.
pub agents: Vec<GgReplayAgent>,   // { agent_id, profile, origin, origin_id,
                                  //   spawn_ordinal, dispatch, terminal_status,
                                  //   limit_hit }
```

Also satisfies playback R5 (per-agent terminal status) in the same row.

**(d) Seed files reference the blob pool.** `GgReplaySeed.provided_files:
Vec<GgSeedFile { path, blob: u32 }>`. An autoload run's reference mockups are
*already* in the blob pool (they were sent to the model), so the seed costs **zero
additional bytes**. This resolves playback's "record size vs self-containedness"
open question outright — take both.

**(e) `GgClientRole`** on `GgReplayRequest`, `#[serde(default)] → Agent`. Replay
already wraps `compaction.handoff_client`; the discriminator is what makes a
second queue *representable*, and replay's `PromptFrame` attachment rule needs it
independently.

**(f) `GgShellCwd { Workspace, Relative, Absolute }` / `GgShellOrigin`** — adopt,
and use `GgShellCwd` for **both** the tool-result and the `Git` entry (replay's
`Git { cwd: String }` has the identical absolute-path problem). Record
[hook](../apps/docs/src/content/docs/gg/hooks.md) commands — including the
`agent-stop` gate the old `completion` capability became, which is what runs a
build before an ending is accepted.

Everything else in the replay design stands unchanged: four pools, the NDJSON
journal, host-side streaming assembly, the mandatory `End` line, seed-time `.gg/`
git exclusion, container salvage, always-on standard capture, `replay.json.gz`,
and the module move to `crates/core/src/gg_replay.rs`.

### 1.4 `GgSessionSummary` — a rule binding all four features

No feature requires a change to it. But the document builder flattens it whole,
with **arrays contributing only `<path>.count`**. Therefore:

> **Any field added to `GgSessionSummary` by any feature must be a scalar or a
> map, never an array** — an array is silently unqueryable. (`slot_costs` and
> `effective_tools` are already arrays and are handled by the purpose-built
> `model.<id>` / `tool.<name>` namespaces.)

Same rule bites code analysis: `CodeAnalysisSummary.languages` is a `Vec`, so it
would flatten to a useless `code.languages.count`. **The doc builder emits a
derived scalar `code.language` ∈ `{"typescript","rust","mixed","none"}`** — exactly
what `GgFacet::CodeLanguage` was going to compute. Stated once, in the builder.

### 1.5 `RunRecord` — the final additive set

| Field | From | Verdict |
| --- | --- | --- |
| `seed_commit: Option<String>` | code-analysis | **adopt** — `SeededRepo::initial_commit` is computed at `crates/core/src/seeding.rs:268` and thrown away today |
| `code_analysis: Option<CodeAnalysisSummary>` | code-analysis | **adopt** |
| `measurements: BTreeMap<String, f64>` | query language | **reject** (1.2) |

`RunRecord.seed_commit` vs `GgReplaySeed.baseline_commit`: keep both. The first is
host-side, harness-agnostic, authoritative; the second is gg's in-container
observation from `git::ensure_baseline`. They should be equal; a mismatch is
diagnostic, not redundant.

### 1.6 One run-tree artifact convention

Replay and code analysis independently invent the same plumbing. **Replay ships
first and sets the convention; code analysis reuses it.**

| Concern | The one rule |
| --- | --- |
| Run tree | `{run}/<name>.json.gz` at the **tree root**, gzip compact JSON. So `replay.json.gz` **and `code-analysis.json.gz`** — code analysis's uncompressed proposal is overridden; it compresses ~10× and the handler is written once anyway |
| Backend store | `runs/<id>/<name>.json`, opaque bytes, never parsed by the store |
| Route | `GET`/`POST /runs/{id}/<name>`, ungated (private-network model). `GET` content-negotiates on the **request's** `Accept-Encoding`; `bytes_response(content_encoding)` is written once by replay and reused. **Required** — the workspace `reqwest` has no `gzip` feature (`Cargo.toml:230`) |
| Driver mirror | `upload_<name>_to_backend`, beside the existing `finalize_*` uploads |
| POST semantics | **Store-only.** The driver uploads *before* the terminal status post that creates the run row, so the handler has nothing to patch. The lifted column is set by `LiftedRunMetrics` on the ordinary insert (`crates/backend/src/db.rs:1491`, applied at `:333`). Patch the record blob **only** when the row already exists — the backfill case |
| Salvage | `ArtifactCollector::collect_file` (defaulted `Ok(false)`), added once by replay, available to code analysis |
| Snapshot | **Every** new snapshot object passes `scrubber.scrub_json` before `put_object` — `SnapshotBuilder::build` scrubs only the `PerRun` document (`crates/backend/src/snapshot.rs:361`), so a sibling object bypasses redaction entirely. Content-stable per-run objects go under `MEDIA_PREFIX` (`snapshot.rs:52`) with their generation in the key so `with_existing_media` (`:219`) skips them on refresh; corpus-wide objects are plain and rebuilt every refresh by design |

**Free synergy:** replay's seed-time `/.gg/` entry in `.git/info/exclude` is
honoured automatically by code analysis's `ignore`-crate walk (it reads
`.git/info/exclude` by default). The replay journal can never pollute the code
analysis, with no coordination.

### 1.7 One post-run stage rule

Verified: `run_time_seconds` is frozen at `crates/core/src/lib.rs:1243`, before
both stages; `with_runtime_cap` (`:1660`) wraps only the harness session; and
`BuildValidator` **mutates `artifacts.repo_path` in place**
(`crates/core/src/validator.rs:96` install, `:101` build).

> **All post-run analysis runs on the host, after `collector.collect`, before
> `validate`, outside `with_runtime_cap`.**

One rule, one insertion point, satisfying the budget constraint *by construction*
for both features. For code analysis it is also the only placement under which
"what the model wrote" is literally true. It means **a canceled run gets
analysed** — validation is skipped for a cancellation because it is fresh work
that judges output; analysis reads bytes that already exist and renders no verdict.

Drive both through `Option<Box<dyn …>>` fields on `RunEngine` — the
`ReferenceRenderer` pattern: trait declared in core
(`crates/core/src/reference.rs`), implementation supplied by the host
(`crates/driver/src/run.rs`). **This is not stylistic for code analysis: it is
what keeps the crate graph acyclic** (the analyzer crate depends on core for the
contract types, so core cannot depend back) **and keeps `oxc`/`syn` out of every
binary that links core, including desktop.**

### 1.8 Database

| Change | Feature | Ordinal |
| --- | --- | --- |
| `run.updated_at TEXT NOT NULL DEFAULT ''` + backfill + stamping in every mutator | query language | `m20260801_000024` |
| `run.code_analyzer_version INTEGER NULL` | code analysis | `m20260801_000025` |
| `gg_saved_query` | query language | `m20260801_000026` |
| `gg_dashboard` | query language | `m20260801_000027` |

Highest in tree today is `m20260731_000023_add_job_test_type.rs` (verified).
**Ordinals must not collide** — the local k3d `tcab-local` PVC survives branch
switches and a collision crashloops a v0.6.x backend.

Keep both `updated_at` and `code_analyzer_version`: the per-id reconcile makes the
latter unnecessary as an *index freshness* signal, but it is still the backfill's
SQL pushdown.

---

## 2. Dependency graph

```text
                    ┌──────────────────────────────────────────┐
                    │  M0  FOUNDATION                          │
                    │  seed_commit · artifact convention ·     │
                    │  post-run stage seam · gg version+release│
                    │  run.updated_at                          │
                    └───┬──────────┬──────────┬────────────────┘
                        │          │          │
          ┌─────────────┘          │          └──────────────┐
          ▼                        ▼                         ▼
   ┌─────────────┐         ┌──────────────┐          ┌──────────────┐
   │  replay     │         │ code-analysis│          │ query language│
   │  (format v2)│         │  (analyzer)  │          │    (TCQ)     │
   └──────┬──────┘         └──────┬───────┘          └──────┬───────┘
          │ HARD                  │ SOFT                    │
          │                       └────────────────────────►│
          ▼
   ┌──────────────────┐
   │    playback      │
   └──────────────────┘
```

| Edge | Kind | Precisely on what |
| --- | --- | --- |
| replay → playback | **HARD, blocking** | `formatVersion` + `#[serde(default)]`; `GgTurnFingerprint` (now a pool-id fold); the `agents` provenance table covering all five creation paths; seed blobs; `GgClientRole`; `GgShellCwd`/`GgShellOrigin` + recorded hook commands; the invocation envelope (`prompt`, `model_windows`, **resolved** `model_modalities`); preserved global `seq`; the shared `gg_replay` index module |
| code-analysis → query language | **SOFT, one-directional** | `code.*` becomes queryable only when TCQ lands. Ship order matters, correctness does not |
| replay ↔ code-analysis | **none** — shared plumbing only | Replay establishes the artifact/route/mirror/gzip convention and `collect_file`; code analysis copies it. Whichever lands first sets it |
| replay ↔ query language | **none** | Fields replay adds to the summary become queryable free, subject to §1.4 |
| playback ↔ anything else | **none**, plus one anti-requirement | A playback must **never** stamp a `codeAnalysis`, publish a run, or write into the aggregate corpus. Holds today by construction (`replay_driver` does not go through `RunEngine::run_resolved`, and `analyzer: None` is the default seam value) — **add a test** so a future driving replay cannot break it silently |

**Critical path: M0 → replay → playback.** Longest chain, only hard dependency.
The query language and code analysis are fully parallel to it and to each other.

---

## 3. Build order

Milestones are independently shippable. Tracks **A** (replay/playback), **B**
(query), **C** (code) run in parallel after M0.

### M0 — Foundation (serves all four)

1. `RunRecord.seed_commit`, populated from `seeded.initial_commit` (already in
   scope at `crates/core/src/lib.rs:1184`).
2. The artifact convention: `Store::{run_X_path,write,read}` shape,
   `bytes_response(content_encoding)` with `Accept-Encoding` negotiation,
   `ArtifactCollector::collect_file` (defaulted `Ok(false)`) on both
   `CliArtifactCollector` and `KubernetesArtifactCollector`, `flate2` promoted to
   `[workspace.dependencies]`.
3. The post-run stage seam in `run_resolved`: one insertion point after
   `collector.collect`, before `validate`, outside `with_runtime_cap`, driven by
   `Option<Box<dyn …>>` fields.
4. `crates/gg` and `crates/core` take `version = "0.7.0"`; `release.yml` gains a
   `gg` binary on `x86_64` **and** `aarch64` musl legs; `release_download_command`
   moves to `releases/download/v{version}/gg-{target}`.
5. `m20260801_000024_add_run_updated_at` + stamping in `Db::{push,add_review,
   publish}` and both startup backfills.

**Verify:** `cargo nextest run --workspace`; `cargo build -p test-cabinet-gg
--release && gg --version` prints `gg 0.7.0`; a local `tcab run` records
`subject.harnessVersion == "0.7.0"` and a non-empty `seedCommit`; a backend test
asserts push→review→publish yields three strictly increasing `updated_at`; a
scratch prerelease produces `gg-x86_64-unknown-linux-musl` as an asset.

### M1 (A) — Replay format v2 + streaming capture

Create `crates/core/src/gg_replay.rs` with the **reconciled** v2 types from §1.3.
Rewrite `GgRecorder` as a bounded-channel NDJSON journal writer with atomic stop.
Widen `PromptItem` with retention/slot/region/turn. Add `/.gg/` to the seeded
`.git/info/exclude`. Add host-side `assemble_journal_to_gz` (segment-file
streaming) into the M0 seam. Salvage the journal from `hung`/`timed_out`
containers via `collect_file`.

**Verify:** `npm run gen:contract && scripts/ci/contract-drift.sh` clean;
`cargo doc --workspace --no-deps` clean after the module move; a local gg run
leaves `{run}/replay.json.gz` at the tree root with `implementation/.gg/` gone;
`git -C implementation status --porcelain` never lists `.gg/`; a killed run yields
`truncation.reason == "session_killed"`; `curl -sI $BACKEND/runs/<id>/replay`
shows no `content-encoding`, `curl -sI --compressed` shows gzip.

**Note:** leave `ContextItem`'s `#[allow(dead_code)]` block alone —
`prompt_items()` reads the fields directly and the accessors stay unused; removing
it fails clippy's `-D warnings`.

### M2 (A) — Always-on replay + the console view

Remove the capability gate; `replay` becomes the full-fidelity escalation (read
**any** agent, not `agents[0]` — the old gate was root-only and silently did
nothing on a non-root agent). Add `GgRunLimits.replay_max_bytes`. Delete
`replaySteps.ts` for `replayModel.ts`; reuse the live monitor's pooled-message
components; add the Context column, the version banner and the truncation notice;
ungate both entry points (`packages/ui/src/app/pages/runs/[runId]/RunGgPage.tsx`
— note the path is under `pages/runs/[runId]/`, **not** `pages/runs/gg/`).

**Verify:** a gg case with **no** capabilities configured produces
`{run}/replay.json.gz` and a visible Replay link; gzipped size well under 1 MB for
~30 turns; the view walks with the Context column populated and an inline image
resolved from the blob pool; a POSTed legacy v1 record still walks behind the
older-gg banner.

### M3 (B) — TCQ core: document model + mirrored evaluator

`crates/core/src/gg_query.{rs,doc.rs,eval.rs}`. Author
`gg_query.conformance.json` **next to the Rust test** (not in
`packages/run-record/src`, which is 100% generated and whose `files` is
`["dist"]`). Delete both `gg_aggregate.rs` files, rewrite the six intra-doc links,
swap the contract-codegen modules and schema docs. Add `Db::gg_run_versions()` /
`gg_runs_by_id()`, `GgDocIndex` with **per-id** reconcile, and `POST /gg/query`,
`POST /gg/query/batch`, `GET /gg/fields`.

**Steps 1–4 must land together on one branch** — three crates, a very large
generated diff, and `cargo doc` fails hard on any missed link.

**Verify:** `cargo nextest run -p test-cabinet-core gg_query`;
`contract-drift.sh` clean; `scripts/ci/rust-lint.sh` (its `cargo doc` under denied
warnings is the load-bearing gate); `gg_docs.test.rs` proves an `add_review` after
indexing changes the doc's `score`/`rating`/`reviewCount`; a curl'd group-by
returns buckets summing to `totalRuns`.

### M4 (C) — The analyzer crate, offline

`crates/code-analysis` depending **one-way** on `test-cabinet-core`. The
`.gitignore`-honouring walk; the three-rung authored-set ladder; the derived
per-file parse stack shared by both front ends; both front ends; the module graph
with Tarjan SCCs; the clone detector; the rollup. `tcab analyze <dir>`.

**Verify:** `cargo tree -p test-cabinet-core | grep -E 'oxc|syn 2|code-analysis'`
is **empty**; `cargo nextest run -p test-cabinet-code-analysis` (fixtures,
`complexity_parity`, **both** stack-safety tests, `rust_stack_per_byte_calibration`,
both determinism tests including forced truncation, the four authored-set tests).
Then the demo: **`cargo run -p test-cabinet-cli -- analyze crates/gg`** prints
gg's own metric table, instantly, with no run and no infrastructure.

### M5 (B) — Discover + visualizations

The TypeScript lexer/parser/compiler/formatter/completer, the mirrored evaluator +
`fieldCatalog` reading the same conformance fixture, `QueryEditor`,
`GgFieldSidebar`, `GgDocTable`/`GgBucketTable`, `TimeRangePicker`,
`GgDiscoverPage`, the legacy-URL transcoder, `timeSeriesChart`, optional
`ciLow`/`ciHigh` on `DistributionGroup`, `GgVizPanel`.

**Verify:** `npx vitest run packages/ui/src/app/pages/gg/query` (conformance
including the field catalog and the astral-character ordering case); then
`/gg/query` — `cap.` suggests capability fields with counts, `cap.compaction:`
offers **both** `true` and `false` with non-zero counts, a long-run filter shows no
`0s` rows, a date histogram draws chronologically with no zigzag, and an old
`/gg/aggregate/results?...` link redirects to an equivalent query.

### M6 (A) — Replay capture completeness + the old-binary path

Wrap `compaction.handoff_client`; record `ModelError`, request shape, `Git`
entries (stdout/stderr interned), the cancel probe, the deadline clock, and
hook shell commands with `GgShellCwd`. Rewrite `replay_driver`
onto the shared index (delete its pre-pass and the dead
`ReplayClient`/`ReplayInvoker`). Add `crates/gg/src/replay_inputs.rs` with an
**async, yielding** `await_turn`. Add gg's `replay` subcommand (keeping bare
`--config` as an implied `run`) and `tcab gg-replay <RUN_ID> | --record <FILE>
[--gg VERSION|PATH]` — **`--record` is kept**, the run-id form is added as an
optional positional; silently demoting a shipped flag to a positional is the same
class of break the design protects `gg --config` from.

**Verify:** a handoff-compaction run's summarizer call now appears in the record
(it does not today); a vision-unsupported failure records
`model_error → model_io → prompt_frame` and reconstructs cleanly; a speculation
case's `diff_since` patch and its judge prompt share one text-pool index;
`tcab gg-replay --record <v1 record>` still reconstructs.

### M7 (C) — Code analysis on the run path + the Code tab

Wire `StaticCodeAnalyzer` into the M0 seam at CLI, driver and desktop (`None`
everywhere else). `RunRecord.code_analysis`. `{run}/code-analysis.json.gz`, store
slot, route, driver mirror, `m20260801_000025` + `LiftedRunMetrics
.code_analyzer_version` on the **insert** path,
`Db::backfill_code_analyzer_version` at startup. Generalise `MemoryTreemap` into
`primitives/plot/Treemap.tsx`; add `horizontalBarChart`; build `RunCodePage`
(provenance strip, KPI row, treemap, explorer + symbol table, outliers, cycles
callout).

**Verify:** a local `tcab run --test-case coil` — the record carries
`codeAnalysis` and `seedCommit`, `treeBasis == "preValidation"`,
`authoredBasis == "seedCommit"`, `runTimeSeconds` unaffected, and — **the ordering
proof** — `implementation/dist/` exists in the tree while contributing **zero**
files to `size.files`. Kill a run mid-session: the canceled record still carries
`codeAnalysis`. `curl $BACKEND/runs/<id>/code-analysis` resolves and the `run`
row's `code_analyzer_version` is set **with the POST's patch branch disabled**.

### M7.5 (A) — The invocation envelope: `seed` and the `agents` table

**Added after M7, because M6 did not close it and nothing else claimed it.** M6
shipped as "replay capture completeness" while `gg_replay_assembly.rs` still
writes `seed` and `agents` as hardcoded empties at both fidelities —
`GgReplayAgent` is constructed nowhere outside its own tests. §1.3(c) and §1.3(d)
specify both, and §2's dependency table lists them inside the replay→playback
edge it marks **HARD, blocking**. Six step reports have disclosed the gap as
out of scope; this step is the owner.

Add the journal's provenance lines and assemble them: `GgReplaySeed` with the
invocation envelope (`prompt`, `model_windows`, **resolved** `model_modalities`,
`baseline_commit` from `git::ensure_baseline`, and `provided_files` as blob-pool
refs — the pool already holds the bytes, so this costs none), and one
`GgReplayAgent` row per agent covering **all five creation paths**, not only the
ones that happened to record an entry.

**Verify:** a run that spawns a sub-agent which then records nothing still has
its row in `agents` — the case `ReplayInputs::agent_ids` gets wrong today,
because it derives the agent set from entries rather than from the table.
`provided_files` resolves against the blob pool with no growth in the record's
compressed size beyond the refs themselves.

### M8 (A) — Playback: seams and single-agent

`ShellRunner` + `ToolContext.{agent_id,shell}` (59 construction sites unaffected
via defaulted `new`), `SessionSeams`/`run_with_seams`,
`AgentIdentity`/`client_for_agent` across all **eight** sites (including
`crates/gg/src/agent.transitions.rs:412`), `CapturingSink`, then
`crates/gg/src/playback/` with the recorded factory, the drift matrix, the strict
`DirtyWorkspace` guard, and `stopped_on` on the report.

`RecordedClientFactory::client_for` (the non-identity method) returns an
**unbound** client — correct `model_id()`, playback error on any `complete` — not
an `Err`, so the `fork` site's model-naming resolution works and no live call is
possible.

**Verify:** the round trip — drive a `MockClient` session with capture on, play it
back into a `TempDir`, assert `divergences.is_empty()` and that
`context_projection` (**excluding** `Prompt::duration_ms` and every `TurnTiming`)
matches the original. Existing suites green unchanged after the seam steps.

### M9 (B) — Dashboards, saved queries, publishing

Entities and endpoints, `GgSavedQueriesPage`, `GgDashboardsPage`/`ViewPage` with
one batch request, `overviewDashboard.ts`. Then `GgRunsFile` +
`SnapshotIndex.ggRunsKey`, the experimental-case export filter,
`redacted_for_public`, `scrub_json`, the static `ggData` implementation, and
re-gating `PageLayout`'s Analyze control (`packages/ui/src/app/components/
PageLayout.tsx:223`) on `canExecute || hasGgData`.

`GgRunDoc.fields` gains `code.*`, the derived `code.language`, and
`has.codeAnalysis` — **this is the milestone that makes code metrics queryable and
publishable.**

**Verify:** the overview dashboard renders 8 panels from **one** batch request;
a built static site's `/gg/query` makes zero backend calls, renders the snapshot
build time, shows no experimental case. Correctness by feeding the shipped
`gg-runs.json` to **both** evaluators and diffing — **never** console-vs-site,
whose corpora legitimately differ.

### M10 (A) — Playback: multi-agent, the barrier, fixtures

The recorded shell with per-agent queues, tool re-execution + `faithful`, the
binding table across all five creation paths, the `seq` barrier, board-dispatched
agents end to end, responses-as-code playback, `tcab gg-playback`, the fixture
suite.

**Verify:** the headline demo — `tcab gg-playback --record … --report …` with
`OPENROUTER_API_KEY` **unset** reports `FAITHFUL: yes` in seconds against a run
that took 38 minutes; then edit one line of `system-tools.hbs`, rebuild, re-run:
exit 1, `components: system`, a readable diff, and the report **still written**.
Separately: `--ordering free` on a two-issue board record produces conversation
drift while `--ordering seq` produces none.

### M11 (C) — Code-analysis backfill + public summary

`tcab analyze-runs` over the ungated `archive.tar.gz`, with `--dry-run`,
`--force`, `--allow-basis-downgrade`, a `GET /health` preflight that prints the
in-cluster invocation on failure. `CodeSummaryOut` + `RunSummary.code` +
`PerRun.codeAnalysisKey` under `MEDIA_PREFIX` with the generation in the key,
scrubbed.

**Verify:** `--dry-run --limit 20` against staging, then live, then re-run → 0 to
do; bump the analyzer version and confirm it re-selects; `--force` against a
`preValidation` run is **skipped** until `--allow-basis-downgrade`; two snapshot
refreshes upload the analysis object **once**.

---

## 4. Why M0 first

Five small, unrelated-looking changes. Four of the five are defects worth fixing
regardless of whether any feature ships.

| M0 item | Unblocks | Standalone value |
| --- | --- | --- |
| `seed_commit` | code analysis's exact authored set; replay's seed identity | The value is **already computed** at `seeding.rs:268` and discarded. Without it, "which files did the model write?" is answered by a root-commit guess that an amend turns into a silent, confident report of near-zero authored code |
| Artifact convention + `collect_file` + `flate2` | replay M1, code analysis M7 | Otherwise two features invent the same store slot / route / mirror / gzip handler and diverge. `collect_file` also makes salvaging a `hung` run's artifacts possible at all |
| Post-run stage seam | replay M1, code analysis M7 | The *one* structural guarantee that satisfies the budget constraint. Written once, it cannot be got wrong twice — and placing it before `validate` is the only placement under which the analysed tree is what the model wrote |
| gg version + release pipeline | playback's binary resolution; replay's record identity | **`gg --version` prints `0.0.0` today**, so `RunSubject.harness_version` is a constant on every gg run ever recorded, and **no `gg` release asset has ever existed** (`grep -rn 'gg-v' .github/ scripts/` returns nothing). Fixing a wrong field on the entire corpus is worth a milestone alone |
| `run.updated_at` + stamping | the query language's document index | `finished_at` is the *record's* timestamp — untouched by `add_review`, `publish`, or a re-`push` that rewrites the blob. Any freshness scheme keyed on it serves permanently stale scores, ratings and publish state. A latent correctness bug in any future caching layer |

None is more than a few hundred lines; all five are verifiable in isolation.
Landing them together removes every cross-feature coordination point except the
two genuine ones (replay→playback's format, code-analysis→query's namespace).

---

## 5. Open questions

> **ALL EIGHT ARE ANSWERED. The owner's decisions are below and are final.** The
> per-question prose that follows is the original analysis and recommendation,
> kept for its reasoning — but where a recommendation differs from the decision,
> **the decision wins**. Q2 is the one that diverges.
>
> | # | Decision | Matches rec.? |
> | --- | --- | --- |
> | Q1 | Replay records are **never** emitted to the public static site. gg documents and code analysis may be. | yes |
> | Q2 | **Do not backfill** code analysis. The corpus starts at ship day. | **no** — rec. was (a), decision is (c) |
> | Q3 | Runs/data are **not** account-scoped; saved **views** are. Matches how runs and coverage plans already work. | yes |
> | Q4 | A playback is **never** ingestible as a run. | yes |
> | Q5 | Salvage **only** the replay journal from a hung/timed_out container. | yes |
> | Q6 | **No** CLI for the query language. | yes |
> | Q7 | Real recorded sessions **may** be committed as test fixtures. | yes |
> | Q8 | A code figure **never** influences a run's score or verdict. | yes |
>
> Consequence of Q2 to plan around: **about half of M11 disappears**, and the
> `code.treeBasis` / `postValidation` provenance machinery no longer has a
> historical-corpus job to do. It is still worth keeping for the
> forward-looking reason — the basis can still degrade on a live run (R5) — but
> it is no longer load-bearing for a backfill that will not happen.

Ordered by how much downstream work each blocks. Each has a recommendation.

**Q1 — What goes on the public static site: nothing, gg documents, or gg
documents plus code analysis?** *Blocks:* M9 and M11 entirely; changes M2's
posture on replay records. The three designs answer differently by omission.
**Recommendation: export gg documents and code analysis; not replay records.** A
document and an analysis carry configuration ids and outcome numbers, no prompts
and no model output; a replay record is the complete conversation verbatim.
Restricting the export to *published* runs makes the public query surface nearly
empty and defeats the goal. Redaction is the control (drop `statusDetail`, drop
long string params, filter experimental cases, run `scrub_json`).

**Q2 — Is `postValidation` code analysis worth backfilling at all?** *Blocks:*
about half of M11. (a) backfill everything and rely on the `code.treeBasis` field;
(b) backfill but exclude from aggregation by default; (c) don't.
**Recommendation: (a) with the downgrade guard.** The `.gitignore` walk removes
nearly all build output, `treeBasis` makes the residual sliceable, and the
alternative is a corpus that starts empty on ship day.

**Q3 — Should the gg run population be account-scoped?** *Blocks:* M3's index
shape and M9's saved-object model. Today `aggregate_gg` takes `AuthUser` and
ignores it; the new saved objects *will* be per-account.
**Recommendation: keep the asymmetry — shared data, private views.** Scoping the
data needs a `user_id` column on `run` and a backfill.

**Q4 — Should a playback ever be ingestible as a run?** *Blocks:* nothing today;
determines whether M10 needs a corpus partition.
**Recommendation: no, for now.** A reconstruction either duplicates a session
already in the corpus or reconstructs one that could not have happened. If wanted,
it needs a `reconstructed: true` marker and a partition — a query-language
decision, not a playback one.

**Q5 — Should a `hung`/`timed_out` run keep its partial implementation tree, now
that `collect_file` exists?** *Blocks:* nothing; would expand M0's salvage and let
M7 analyse those runs. It changes what a hung run means to validation, publishing
and the review worklist. **Recommendation: salvage only the replay journal, as
designed.** Revisit as its own change.

**Q6 — Should the query language get a CLI?** *Blocks:* nothing. The parser is
TypeScript-only by design; a CLI forces a second Rust parser on top of the already
mirrored evaluator. **Recommendation: no.**

**Q7 — May real recorded sessions be committed as test fixtures?** *Blocks:*
M10's fixture suite, the strongest part of playback's value. A record contains a
commercial model's verbatim output and the case's full prompt.
**Recommendation: yes**, following the existing `crates/gg/src/testdata/*.txt`
precedent (15 committed real model replies), ≤500 KB each post-pooling with
`--strip-images`, capped at ~6.

**Q8 — Should a code figure ever influence a run's score or verdict?** *Blocks:*
nothing. **Recommendation: no — purely descriptive.**

---

## 6. Risk register

Deduplicated across the four designs, ordered by severity.

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | **Parser stack overflow aborts the driver pod.** Both `oxc` and `syn` are unguarded recursive descent; overflow is `SIGABRT`, not a catchable panic. Model source is untrusted input. Now *before* validation, so a larger blast radius | Critical | **Derive** the stack from the file (`bytes × 1_261 × 3`, clamped 64 MiB–1 GiB) rather than fixing it; cap parsed files at 256 KiB (larger = size-only); a bracket-nesting prescan; `catch_unwind` on the parse thread; a calibration test **per front end**; a `the_hungriest_files_the_caps_admit_still_parse` test at exactly the cap in the **dev** profile. Treat a thread-spawn failure as size-only, never a panic. **The measured 1,261 B/source-byte figure comes from `crates/gg/src/sandbox/transpile.rs`; raising the byte cap without raising the stack breaks the derivation** |
| R2 | **Mirrored-evaluator drift.** `evaluate()` **and** `field_catalog()` exist twice and can publish different numbers on console vs public site | High | One checked-in conformance fixture executed by both suites, covering absent-field semantics, the total `cap.*` projection, sparse `tool.*`, globs, open ranges, interpolated quantiles at n=1..4, date-histogram floors incl. the Monday week origin, astral-plane string ordering (TS must use code-point arrays, never `<` or `localeCompare`), and absent-`finished` sort position. **The fixture must grow with every semantics change** |
| R3 | **Contract cutover blast radius.** M3 deletes the whole facet/metric vocabulary across three crates (core, backend, **gg** via `crates/gg/src/summary.rs:233`); `cargo doc` fails hard on any missed intra-doc link | High | Land M3's steps 1–4 together, never trickled. `rust-lint.sh`'s `cargo doc` under denied warnings is the gate. Do **not** land code analysis's UI work mid-flight |
| R4 | **Stale Tauri desktop builds lose the gg surface.** Separately distributed, user-configured backend URL, **no version negotiation** in `httpBackend.ts` | High | Accepted rather than shimmed (a shim keeps the whole deleted vocabulary alive). Render an explicit "this backend is newer than this app" panel on a 404 instead of an error boundary. Re-release desktop alongside the backend |
| R5 | **Silent basis degradation.** `allFiles` and `postValidation` both change what is measured | High | Recorded; queryable; a provenance strip on the Code tab; a mixed-bucket warning on aggregate results. **The display half is what gets cut under time pressure — treat it as load-bearing** |
| R6 | **Agent-binding mis-attribution under playback** hands agent A the responses recorded for agent B | High | Two independent defences: provenance keyed on board state or a spawner's own ordered turn loop (never the global counter), plus the turn fingerprint, which catches a mis-binding on its first request. If the `agents` table ships incomplete, the fingerprint is the only defence and it fails open under `Shape` |
| R7 | **Publishing bypasses the scrubber** (`snapshot.rs:361` walks only the `PerRun` document) | High | §1.6's rule, asserted by a test on each new object |
| R8 | **`run.updated_at` is enforced by convention.** A future mutator that forgets to stamp it silently reinstates stale documents | Medium | Tests cover push/add_review/publish/delete. Add the obligation to the column's doc comment; route new mutations through one helper |
| R9 | **Corpus incomparability across analyzer generations** reads as a real change in model behaviour | Medium | Version on every result, lifted to a column, queryable, plus the mixed-bucket warning. Bump policy explicitly includes **cap changes** |
| R10 | **Discoverability regression.** A text box is harder to start with than a widget builder | Medium | The sidebar and the examples menu are **not polish** — do not ship the editor without them. The sidebar carries extra weight because sparse `tool.*` fields must be *seen*, not inferred |
| R11 | **Reference counting is approximate in both languages**, worst exactly where this corpus lives (barrels, namespace imports, bundler HTML entry points) | Medium | Labelled via a **data field**, so picker/axis/header/docs cannot disagree. Blind spots enumerated on the docs page. Honest in aggregate, unreliable per symbol |
| R12 | **Non-atomic capture stop** would shift every later pool index and substitute the wrong message into a reconstructed prompt | Medium | Minting and sending under one mutex; a failed send stops capture for the **whole run**; pools are always a contiguous prefix; assembly hard-errors on a gap or dangling ref |
| R13 | **`Strictness::Shape` reconstructs a session that did not happen** and gets reached for to unblock a red build | Medium | Loud: a pre-first-turn warning on the root stream, `faithful: false`, the mode stamped on the report and the exit code |
| R14 | **Backend memory and cold start.** The index deserializes every gg run's `record_json` on first access; documents are inlined into the static bundle | Medium | Steady state is one narrow `(id, updated_at)` projection per 30s plus a rebuild of only changed rows — the same work `aggregate_gg` does *per query* today, paid once. Fine to ~50k runs at ~2 KB/doc; past that both ends need paging |
| R15 | **Parser scope creep.** ~1200 lines of hand-written TS with no library (verified: no lezer/chevrotain/peggy in any `package.json`) | Medium | Freeze the grammar for v1 |
| R16 | **k8s salvage is untested by local Docker.** A `cp` from a Docker container proves nothing about `kubectl cp` from a pod in a terminal state | Low | Exercise `collect_file` against k3d |
| R17 | **Segment-file assembly doubles transient disk** (~512 MiB against a 256 MiB journal ceiling) | Low | Scratch path must be on the **same volume** as the run tree, not `/tmp` |
| R18 | **Model-shrunk measurement.** An over-broad `.gitignore` shrinks the measured tree | Low | `notes.gitignore_applied` records that ignore files were in play. A follow-up could count ignored-but-walked paths |

---

## 7. Research index (so you do not re-explore)

All verified at `4af242d9`.

### Replay, as it exists

- `crates/core/src/gg.rs`: `CAPABILITY_REPLAY` `:1114`, `GG_REPLAY_ARTIFACT_PATH`
  (`.gg/replay.json`) `:1124`, `GgReplayEntryKind` `:3491`, `GgReplayEntry`
  `:3547`, `GgReplayRecord` `:3576`, `GgReplayStep` `:3683`. Also
  `GgRunLimits` `:2015`, `GgInvocation` `:2217`, `GgSessionSummary` `:3332`.
- `crates/gg/src/replay.rs`: `ReplayModelRequest` `:45` (serializes the **whole**
  conversation every turn — the quadratic term), `GgRecorder` `:61`,
  `GgRecorder::push` `:105` (mints the global `seq`; stamps only `agent_id`),
  `RecordingClient` `:149`.
- `crates/gg/src/replay_driver.rs`: `ReplayClient` `:198` (**dead in
  production**), `ReplayInvoker` `:246` (implements no trait), `reconstruct`
  `:331`, `reconstruct_with_sink` `:337`.
- `crates/gg/src/message_log.rs`: `fingerprint` `:48` (64-bit `DefaultHasher`,
  hashes image **descriptors** — not a content address for images),
  `MessagePool` `:146` (per agent; answers "is this new?", not id→index).
- Backend: route `/runs/{id}/replay` `crates/backend/src/api.rs:252`; handlers
  `run_replay` / `put_run_replay` `crates/backend/src/api/test_cases.rs:356`
  / `:366` (**`put_run_replay` touches no DB — the precedent for §1.6**);
  `bytes_response` `:681`; store slots
  `crates/backend/src/store.rs:1258/1264/1277`.

### gg internals playback needs

- **Eight** `client_for` sites: `crates/gg/src/agent.rs` `731`, `1801`, `2356`,
  `2591` (handoff summarizer — **not** wrapped in `RecordingClient` today),
  `2796`, `3330`, `4221`; plus `crates/gg/src/agent.transitions.rs:412` (the
  `fork` tool, re-resolving the forker's own binding). Trait at
  `crates/gg/src/client.rs:3071`; `ScriptedFactory` impl at
  `crates/gg/src/agent.test.rs:4840`.
- `crates/gg/src/lib.rs:85` — `#[tokio::main(flavor = "current_thread")]`. **All
  agents on one runtime**: a blocking wait deadlocks the process; a synchronous
  file write stalls every agent and skews turn timings.
- `crates/gg/src/tools/mod.rs:255` — `ToolContext` (today `{workspace_dir,
  vision}`; 59 construction sites, 57 in tests).
- `crates/gg/src/tools/shell.rs`: `ShellTool::invoke` `:295`, `run_command` `:341`
  (the single choke point all three command paths reach).
- Board is run-global `Arc<Mutex>`, rendered into every agent's pinned prompt each
  turn — the reason the `seq` barrier exists.

### Engine / run pipeline

- `crates/core/src/lib.rs`: `write_record` `:1014`, `run_resolved` `:1076`,
  `run_time_seconds` frozen `:1243`, `build_failed_record` `:1488` (writes default
  metrics — the reason `metric.*` must be absent not zero), `write_run_streams`
  `:1566`, `with_runtime_cap` `:1660`, `SKIPPED_DIRS` `:1710` (only
  `node_modules`), `copy_tree` `:1718`.
- `crates/core/src/execution.rs`: `SeededRepo` `:76`, `initial_commit` `:80`,
  `trait ArtifactCollector` `:345`.
- `crates/core/src/seeding.rs`: `init_repo` called `:268` (returns the seed sha),
  the `Seed test case` commit `:1012`, the `.git/info/exclude` precedent `:983`
  and `:1128`.
- `crates/core/src/validator.rs`: `BUILD_OUTPUTS` `:33`, install `:96`, build
  `:101` (**both run in `artifacts.repo_path` — this is why analysis runs before
  validate**), `run_step` `:3013`.

### Aggregation, as it exists

- `crates/core/src/gg_aggregate.rs`: `GgSummaryField` `:45`, `GgFacet` `:200`,
  `param_scalar` `:432`, `GgMetric` `:452`, `GgAggregation` `:477`, `GgFacetOp`
  `:520`, `GgAggregateQuery` `:632`, `GgAggregateRow` `:664`, `aggregate` `:807`.
- Route `/gg/aggregate` `crates/backend/src/api.rs:295`.
- `crates/backend/src/db.rs`: `push` `:293`, `add_review` `:418`, `publish` `:558`,
  `delete_run` `:600`, `list_gg_runs` `:1004`, `LiftedRunMetrics` `:1491`,
  `lifted_run_metrics` `:1509`, `backfill_gg_presets` `:3546` (the shape to copy
  for a startup backfill).
- Snapshot: `MEDIA_PREFIX` `crates/backend/src/snapshot.rs:52`,
  `with_existing_media` `:219`, `scrub_json` `:361`.
- UI: `packages/ui/src/app/pages/gg/` (`GgAggregatePage`,
  `GgAggregateResultsPage`, `GgDashboardPage`, `GgSessionsPage`, `ggQuery.ts`);
  route `ggReplay` `packages/ui/src/app/routes.ts:177` / `:339`; the Analyze
  control `packages/ui/src/app/components/PageLayout.tsx:223` (gated on
  `canExecute`).

### Record & contract

- `RunRecord` `crates/core/src/run_record.rs:572`; `RunMetrics`
  `crates/core/src/metrics.rs:189`.
- `crates/contract-codegen/src/main.rs`: `RUN_RECORD_DEFS` `:51`, the `ts_decls!`
  module blocks from `:142`. **`RUN_RECORD_DEFS` is documented as "every type in
  the `RunRecord` tree except the root" and is the run-record document's `owns`
  — a type unreachable from `RunRecord` must NOT go in it** (`finalize_schemas`
  in `emit.rs` only rejects a name claimed by *two* documents; it never checks
  that an owned name resolves, so the registration silently produces dangling
  cross-document refs).
- Migrations: highest is
  `crates/migration/src/m20260731_000023_add_job_test_type.rs`. Register in
  **both** lists in `crates/migration/src/lib.rs`.

### Release / versioning

- Root `Cargo.toml:61` — `version = "0.0.0"` (why `gg --version` is `0.0.0`).
- `.github/workflows/release.yml` builds **five** binaries; `grep -rn 'gg-v'
  .github/ scripts/` returns **nothing** — no `gg` release asset has ever existed.
- `crates/core/src/gg_exec.rs`: default version `:154`, target derivation `:196`
  (`{ARCH}-unknown-linux-musl`), `release_download_command` `:280`, URL `:281`
  (`releases/download/gg-v{version}/gg-{target}` — the tag the workflow never
  creates).
- Workspace deps already present: `sha2` `Cargo.toml:288`, `hex` `:290`, `oxc`
  `:365` (0.141, `semantic`/`transformer`/`codegen`), `toml` `:175`, `time`
  `:174`. `reqwest` `:230` has **no `gzip` feature** — the reason `GET` must
  content-negotiate.
- Ungated archive: `/runs/{id}/archive.tar.gz`
  `crates/artifacts/src/api.rs:115` — the backfill's source, no token needed.

---

## 8. Environment gotchas (will bite you)

- **Cargo target is shared at `/cargo-target/the-test-cabinet/`**, not `./target`.
  Built binaries live under `/cargo-target/the-test-cabinet/release/…`.
- **Use `cargo nextest run --workspace`, never `cargo test`.** A command hook
  **blocks any shell command containing the string `cargo test`** and rejects the
  whole command before it runs — so do not put a file write in the same command,
  and do not try `cargo test --workspace --doc` either (likewise blocked).
- **Docs build:** `cd apps/docs && npm run build`. **A missing sidebar slug in
  `apps/docs/astro.config.mjs` fails the build**; broken heading anchors do not.
  Every new page needs its slug registered.
- **Contract pipeline is one-way and gated.** Rust (`contract` feature) →
  `crates/contract-codegen` → `packages/run-record/src/*.ts` +
  `apps/docs/public/schema/**`. Regenerate with `npm run gen:contract`; CI gate is
  `scripts/ci/contract-drift.sh` (fails on any diff, and its
  `git diff --exit-code -- packages/run-record/src` covers new generated files for
  free). **Never hand-edit generated TS or schema JSON.**
- **`scripts/ci/rust-lint.sh` runs `cargo doc` under a workspace-wide
  `deny(warnings)`** that covers rustdoc lints — a dangling intra-doc link is a
  hard CI failure. This is the load-bearing gate for M1's module move and M3's
  deletion.
- **Rust unit tests live in sibling `.test.rs` files** included via `#[path]`.
  Follow that convention.
- **`make run-images` is required after changing run-container tooling**;
  `make local-rebuild` skips those images.
- markdownlint/cspell pre-commit hooks are scoped to `test-cases/` and
  `game-jams/` only — they do **not** lint `apps/docs`.
- **Frozen test-case versions:** a version directory with a `.frozen` marker is
  rejected by a commit hook and by CI. Check before touching anything under
  `test-cases/` or `game-jams/`.
- **Local k3d DB is shared across branches** — the `tcab-local` PVC survives
  branch switches, so a colliding migration ordinal crashloops a v0.6.x backend.
- Read `.claude/skills/coding/SKILL.md` before writing code, and the `dataviz`
  skill before any chart work (M5, M7).
