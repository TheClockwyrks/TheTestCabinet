---
title: "Comparison experiments"
---

A **comparison** is a saved, named experiment. It fixes every controlled variable,
varies **one** dimension into a set of **arms**, runs each arm _N_ times to smooth
out variance, and gathers the arms' outcome distributions and
[diagnostics](/comparisons/diagnostics/). Comparisons are created and run **only**
from the internal console and Tauri app; they are [published](/comparisons/publishing/)
read-only to the public site.

## The experiment model

A comparison is one **independent variable** over a set of **held-constant
controls**.

- **Controls (held constant across all arms):** test case slug, version, and
  variant; the model; the [auth mode](#auth-mode-is-a-control); the
  [orchestrator](/orchestrators/overview/); and the container/run image build.
  These are exactly the identifying dimensions of a [run](/components/core/run-records/)
  minus the one being varied.
- **Independent variable (the arms):** normally the **harness** — one arm per
  harness (`pi`, `opencode`, `kilo`, `codex`, `cline`, …). The same machinery
  generalizes to varying a **gg [configuration](/gg/configurations/)** instead
  (arm = capability set), which is how a gg configuration is compared against a
  third-party harness, and to varying the **model** with the harness held constant.
- **Sample size (`N` per arm):** each arm is run _N_ times. Multiple runs are
  mandatory, not optional — a single run of a harness tells you almost nothing
  because [the spread is large](/comparisons/statistics/) (Pi lands anywhere in
  272K–320K tokens; Kilo in 3.1M–3.4M). `N` is chosen by the operator; the
  statistics page discusses [how small `N` is presented honestly](/comparisons/statistics/#sample-size).

An arm that mixes harness _and_ model (say, "Pi on model A" vs "Kilo on model B")
is not a clean experiment — two variables moved at once. The UI should keep the
non-varied dimensions locked across arms and surface any accidental drift as a
[confound](#confound-detection).

## Triggering the runs

A comparison reuses the existing batch-launch path — it does **not** invent a new
run queue.

- The console's `NewRunPage` already fans a submission out across **harness × model
  combinations × a run count** via `launchBatch()` → **`POST /jobs/batch`**
  (`packages/ui/src/app/pages/runs/launchBatch.ts`). A comparison is that same
  fan-out with a fixed shape: the controls locked, one combination per arm, the run
  count set to `N`.
- gg arms launch through gg's own path (`POST /gg/runs`, `launchGgRun`), not the
  batch endpoint, since [gg is invoked directly](/gg/overview/) rather than as an
  orchestrated run. A comparison that includes a gg arm therefore drives two launch
  paths and reconciles their run ids into the one experiment.
- Runs are matched back to their arm by their [`RunSubject`](/components/core/run-records/)
  tuple, the same way the [coverage plan](/components/backend/overview/) matrix and
  game-jam prior-run matching already identify a `(case, version, variant, harness,
  model)` cell.

The **[coverage plan](/components/backend/overview/)** concept (a saved matrix of
`(case × version × variant × harness × model)` cells, each with a desired run count
and a "trigger all missing" action) is the closest existing machinery. A comparison
may be implemented as, or backed by, a coverage plan of a particular shape — reuse
its top-up/trigger mechanics rather than rebuilding them — but a comparison adds
what a coverage plan lacks: outcome aggregation, diagnostics, statistics, and a
publish path. A coverage plan measures _how many runs exist_; a comparison measures
_how those runs turned out_.

## Automated-only scoring

A comparison can generate dozens of runs. Requiring a human
[review](/components/core/results/#reviews) of each would make it unusable, and the
manual-review points are not what a harness comparison is measuring anyway. So a
comparison scores each run from **automated validation only**.

### What "68/68" means

A run's normal score is `earned / total` over the case's declared
[review checklist](/components/core/results/) — for Carom that is **68/70**, where
68 points are backed by automated validators and the last 2 require a human. The
automated-only score restricts _both_ numerator and denominator to the
auto-covered points, so the same run reads **68/68**: full marks on everything a
machine can check, with the human-only points excluded rather than failed.

### How it is computed

All the data is already serialized on the run record — no human review need exist:

- The auto-verdicts live at `record.validation.debugScripts[]` (see
  [validation](/components/core/validation/)). Each `DebugScriptResult` carries an
  `item_id` (and optional `sub_item_id`) forming the review-item verdict id it
  backs, and a `verdicts: [{ id, pass }]` list.
- The **auto-covered set** — the "68" denominator — is exactly the verdict ids
  present in `debugScripts`, honoring `gates`/`scored` and **skipping**
  `precondition_unmet` scripts (a script that could not run leaves its point for a
  human and contributes to neither numerator nor denominator).
- Convert each `AutoVerdict { id, pass }` to a synthetic `ReviewVerdict { id,
  status: pass ? Pass : Fail }`, restrict the case's
  [`review_items_for(variant)`](/components/core/results/) to the auto-covered ids,
  and run the existing scorer — `score_checklist` in Rust
  (`crates/core/src/review.rs`) or `scoreChecklist` in TypeScript
  (`packages/ui/src/ratings.ts`). The frontend already has the verdict-conversion
  helper: `autoVerdictMap(run)` in `RunReviewEditor.tsx`.

This automated-only score is a **new computed value**. Nothing today derives a
score from auto-verdicts — the existing `run_summary_score`
(`crates/backend/src/snapshot.rs`) returns `None` for a run with no reviews — so it
must be added as its own path. Note the item-level "is this point automated" flag
(`ReviewItem.validation`) is `#[serde(skip)]` and never reaches a stored or wire
record, which is _why_ the coverage set has to be read off the per-run
`debugScripts` rather than off the case's declared items.

## Auth mode is a control

Cost is only comparable when the [auth mode](/components/core/run-records/) matches.
An API-key run's dollar cost and a subscription run's dollar cost do not mean the
same thing, and the record's `RunEnvironment.auth_mode` (`ApiKey` vs
`Subscription`) governs how cost is interpreted. A comparison holds auth mode
constant and uses **`metrics.cost.comparable`**, never `cost.actual`, as the cost
metric — `comparable` is normalized to a common OpenRouter price basis, so a
harness is neither rewarded nor penalized for its billing model. See
[metrics](/components/core/metrics/) for the token classes and cost fields.

## Confound detection

The controls exist to keep the comparison fair; the UI enforces them and flags any
that slip. If two arms differ on a variable that is supposed to be held constant —
auth mode, orchestrator, container build, model (when varying harness) — the
comparison **surfaces the mismatch as a confound** rather than quietly folding the
runs together. A comparison whose arms are not truly comparable is worse than no
comparison; it is the reader's trust that is being spent.

## Data model

A comparison is a new first-class entity, modeled structurally on the
**game-jam aggregate** (a named record that _is_ folded into the public snapshot),
not on the **tournament** (which is live-only and never published — the wrong
precedent). It stores:

- Its identity and controls (case/version/variant, model, auth mode, orchestrator,
  container build).
- Its arms and their run ids, plus `N`.
- Per-arm aggregated [statistics](/comparisons/statistics/) and
  [diagnostics](/comparisons/diagnostics/), computed from the arm's runs.

Backend storage follows the existing SeaORM entity pattern
(`crates/entities/`), and the aggregation contract can follow
[gg's aggregation](/gg/result-aggregation/) (`crates/core/src/gg_aggregate.rs`) —
group-by-arm, aggregate-metric — extended with the dispersion statistics gg's
avg/min/max/sum set lacks.
