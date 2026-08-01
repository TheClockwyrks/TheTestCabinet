---
title: "Comparison experiments"
---

A **comparison** is a saved, named experiment. It fixes the test every arm runs,
pits two or more **configurations** against each other as its **arms**, runs each
arm _N_ times to smooth out variance, and gathers the arms' outcome distributions
and [diagnostics](/comparisons/diagnostics/). Comparisons are created and run
**only** from the internal console and Tauri app; they are
[published](/comparisons/publishing/) read-only to the public site.

## The experiment model

A comparison is a set of **configurations** run against one **held-constant test**.

- **Controls (held constant across all arms):** test case slug, version, and
  variant; the [orchestrator](/orchestrators/overview/); and the container/run
  image build.
- **The arms — one configuration each.** An arm is either:
  - a **harness** configuration — a harness (`pi`, `opencode`, `kilo`, `codex`,
    `cline`, …) plus the model it runs; or
  - a **gg [configuration](/gg/configurations/)** — a capability set plus a model
    bound to every [model slot](/gg/configurations/) it leaves deferred.

  The two shapes sit side by side in the one comparison, which is the point: a gg
  configuration is compared head-to-head against a third-party harness, two gg
  configurations are compared against each other, and the same configuration on
  two models is an ablation — all without switching experiment types.
- **Sample size (`N` per arm):** each arm is run _N_ times. Multiple runs are
  mandatory, not optional — a single run of a harness tells you almost nothing
  because [the spread is large](/comparisons/statistics/) (Pi lands anywhere in
  272K–320K tokens; Kilo in 3.1M–3.4M). `N` is chosen by the operator; the
  statistics page discusses [how small `N` is presented honestly](/comparisons/statistics/#sample-size).

### Why the model is per arm

The model is a property of the configuration, not a comparison-wide control. A gg
configuration can span several models (one per agent role), so it has no single
model to pin; and a harness's usable model ids are family-specific, so a slug that
launches under one harness may be meaningless to another. Pinning one model across
every arm would make "gg vs Pi" unstatable.

The trade-off is real and stays visible: an arm that differs from another in
_both_ its harness and its model has moved two variables at once, and the reader
must weigh the result accordingly. What the system still enforces is that nothing
drifts _within_ an arm — every variable an arm fixes is checked against its runs
and any slip is surfaced as a [confound](#confound-detection).

### Auth mode is not a parameter

Cost is only comparable when the [auth mode](/components/core/run-records/)
matches: an API-key run's dollar cost and a subscription run's dollar cost do not
mean the same thing, and the record's `RunEnvironment.auth_mode` (`ApiKey` vs
`Subscription`) governs how cost is interpreted. But auth mode is decided by the
harness's own credentials configuration, not by whoever launches the run — so a
comparison does not ask for it. It is read back off the runs instead: an arm whose
runs disagree on auth mode is [confounded](#confound-detection), and every figure
uses **`metrics.cost.comparable`**, never `cost.actual`, so a harness is neither
rewarded nor penalized for its billing model. See
[metrics](/components/core/metrics/) for the token classes and cost fields.

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
- Runs are matched back to their arm by the **run ids the arm records at launch**,
  not by their [`RunSubject`](/components/core/run-records/) tuple: two gg arms can
  share a root model and differ only in capability set, which no run tuple
  distinguishes. An arm's membership is therefore explicit, and "trigger missing
  runs" tops it up to `N` off exactly that list.

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

## Confound detection

The controls exist to keep the comparison fair; the aggregation checks them and
flags any that slip. Every variable an arm fixes is compared against what its runs
actually recorded:

- **Harness** and **model** — against the arm's own declaration (a gg arm declares
  neither: its capability set may span several models, so its runs are only
  checked for internal consistency).
- **Auth mode** — for drift _within_ the arm, since it is never declared (see
  [above](#auth-mode-is-not-a-parameter)).
- **Orchestrator** — against the comparison's control.

Any mismatch is **surfaced as a confound** rather than quietly folded into the
runs. A comparison whose arms are not truly comparable is worse than no
comparison; it is the reader's trust that is being spent.

## Data model

A comparison is a new first-class entity, modeled structurally on the
**game-jam aggregate** (a named record that _is_ folded into the public snapshot),
not on the **tournament** (which is live-only and never published — the wrong
precedent). It stores:

- Its identity and controls (case/version/variant, orchestrator, container build).
- Its arms — each a harness + model, or a gg configuration + its slot models —
  and their run ids, plus `N`.
- Per-arm aggregated [statistics](/comparisons/statistics/) and
  [diagnostics](/comparisons/diagnostics/), computed from the arm's runs.

Backend storage follows the existing SeaORM entity pattern
(`crates/entities/`), and the aggregation contract can follow
[gg's query language](/gg/analysis/query-language/) (`crates/core/src/gg_query.rs`) —
a `stats` stage that is group-by plus aggregate functions, over a flat run document. Its
`count`/`distinct`/`avg`/`sum`/`min`/`max`/`median`/`p90`/`p95` set already covers the
central tendency and the tail; what a comparison adds on top is the *inferential* half —
standard deviation, confidence intervals, and the significance test between two arms.
