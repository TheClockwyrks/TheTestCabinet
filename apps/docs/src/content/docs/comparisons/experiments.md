---
title: "Comparison experiments"
---

A comparison is a saved, named experiment. It fixes the test every arm runs,
pits two or more configurations against each other as its arms, runs each arm
`N` times to smooth out variance, and gathers the arms' outcome distributions
and [diagnostics](/comparisons/diagnostics/). A comparison belongs to the
identity that created it and is created and run from the console. It is
[published](/comparisons/publishing/) read-only to the public site.

## The experiment model

A comparison is a set of configurations run against one held-constant test. The
stored shape is `ComparisonConfig` (`comparison.rs` in `microservice-backend`).

The controls, held constant across all arms, are the test case slug, version,
and variant, the [engine](/engines/overview/), the
[orchestrator](/orchestrators/overview/), and an optional pinned container
build. The operator selects the engine from the engines the anchored version
supports, and every arm's runs are launched under it.

Each arm is one configuration:

- a harness configuration, a harness slug plus the model it runs; or
- a gg [configuration](/gg/configurations/), the key of a built-in or saved
  capability set plus the model bound to every launch input it exposes.

The two shapes sit side by side in the one comparison. A gg configuration is
compared head-to-head against a third-party harness, two gg configurations are
compared against each other, and the same configuration on two models is a
model comparison, all in the same experiment type.

Each arm is run `N` times. Multiple runs are mandatory, because [the spread
across runs is large](/comparisons/statistics/). The operator picks `N`, and
every view carries an arm's observed count beside its desired one. The backend
validates `N` as at least 1 and at most 50, and a comparison carries at least
two arms.

### Per-arm model selection

The model is a property of the configuration, not a comparison-wide control. A
gg configuration can span several models, one per agent role, so it has no
single model to pin, and a harness's usable model ids are family-specific, so a
slug that launches under one harness may be meaningless to another. Pinning one
model across every arm would make "gg against Pi" unstatable.

The trade-off stays visible. An arm that differs from another in both its
harness and its model has moved two variables at once, and the reader weighs the
result accordingly. What the system enforces is that nothing drifts within an
arm: every variable an arm fixes is checked against its runs, and a slip is
surfaced as a [confound](#confound-detection).

### Auth mode

Cost is comparable only when the [auth mode](/components/contracts/run-records/)
matches, since an API-key run's dollar cost and a subscription run's dollar cost
do not mean the same thing. Auth mode is decided by the harness's own
credentials configuration rather than by whoever launches the run, so a
comparison reads it back off the runs: an arm whose runs disagree on
`RunEnvironment.auth_mode` is confounded. Every figure uses
`metrics.cost.comparable`, so a harness is neither rewarded nor penalized for
its billing model. See [metrics](/components/contracts/metrics/) for the token
classes and cost fields.

## Which runs an arm holds

An arm counts runs the way a
[coverage plan](/components/backend/coverage/#counts-are-global-reviews-are-labels)
counts them. The comparison's controls and an arm's configuration form one
coverage cell, and the arm's runs are [that cell's
runs](/components/backend/coverage/#a-cells-runs) under the target `N`. They are
the first `N` counted runs of the cell to finish, whoever launched them and
whenever: this comparison, another comparison, a coverage plan, a ladder, or a
launch by hand.

The cell is identified exactly as a coverage cell is:

- the case pin, from the controls: the slug, version, variant and engine;
- for a harness arm, the harness and the model as it is launched;
- for a gg arm, `gg`, the model the bound set's root agent runs, the
  configuration's id, and the models the bound set runs on.

A gg arm's cell is resolved from the configuration as the account holds it now.
An arm whose configuration has been deleted, or leaves a launch slot unbound, has
no cell and holds no runs.

An arm reports why it cannot be launched as `unlaunchable`, by the rule a
[coverage member](/components/backend/coverage/#a-member-that-cannot-be-launched)
follows for a gg configuration. This covers a configuration that imports a saved
agent edited since the configuration was last saved, whose launches would land in
another cell. Such an arm keeps the runs its cell holds, and the trigger launches
nothing for it.

Which runs count is the [coverage rule](/components/backend/coverage/#which-runs-count):
a run counts when it ended `completed`, `catastrophic`, `timed_out`,
`harness_error`, `limit_exceeded`, or `hung`, and an attempt the backend retried
counts once, as whatever its last attempt became. An `infrastructure` failure, a
canceled run and a deleted run take no place, so the next counted run takes the
place instead.

An arm's jobs in flight are every job of its cell in flight, whoever launched
it, up to what the arm still needs. An arm holding `N` runs therefore reads none
in flight.

An arm reports the runs it holds as `runIds`, in the order they finished, and
its jobs in flight as `inFlight`. Its statistics, diagnostics and published runs
are computed from the runs it holds. `nObserved` is the number of those runs
whose record this build can read. A run whose record no longer decodes keeps its
place, as it does in a coverage cell, and contributes no figure.

Two arms with the same cell hold the same runs. The backend refuses to save a
comparison whose arms share a cell.

## Triggering the runs

A comparison reuses the existing launch paths rather than adding a run queue of
its own. Its "trigger missing runs" action launches, for each launchable arm,
`N` less the runs it holds and its jobs in flight. A comparison whose cells already hold `N`
runs each launches nothing.

- A harness arm launches through the shared batch path, `launchBatch()` →
  `POST /jobs/batch` (`launchBatch.ts` in `ui-common`), with the controls
  locked and one launch item per missing run.
- A gg arm launches through gg's own path, `launchGgRun` → `POST /gg/runs`, one
  request per run, with the arm's slot models bound onto the configuration it
  names.

Nothing is recorded on the comparison at launch. Every launched run joins its
arm's cell, and the comparison read after the launch reports it in flight. The
console shows the reason for each launch the backend refuses.

### A complete comparison

A comparison is complete when every arm holds `N` runs. The console then states
that the comparison is complete in place of the trigger action. Raising `N`
takes in the next runs of each cell in the order they finished, and the trigger
launches whatever the cells are still short of.

### Editing a comparison

Saving an edit (`PUT /comparisons/{id}`) stores the configuration as sent. An
arm's runs follow from its cell, so an edited arm holds the runs of its new cell,
and an edited control moves every arm to the cells of the new controls. Lowering
`N` lets go of each arm's latest runs. A run an edit leaves behind stays stored
as an ordinary run, and one still in flight runs to its end.

## Result computation

Only the configuration is stored. Every arm's statistics and diagnostics are
computed from its counted runs each time a comparison is read
(`aggregate_comparison` in `microservice-backend`), so a comparison always reflects
whatever runs have since landed.

The aggregation is deterministic for a given set of runs. An arm's runs are read
in sorted-id order, and the bootstrap is seeded from those ids, so the console
and the public snapshot show identical numbers and a recomputation never shifts
them.

The endpoints are per-identity, attributed to the request's [Access
identity](/components/auth/overview/):

- `GET /comparisons` and `POST /comparisons`
- `GET`, `PUT`, and `DELETE` on `/comparisons/{id}`
- `POST /comparisons/{id}/publish`

A comparison is deleted from the console's comparison list and detail pages,
through the shared [confirmation dialog](/components/ui/overview/#dialogs).

## Automated-only scoring

A comparison generates dozens of runs, and the manual-review points are not what
a harness comparison measures, so a comparison scores each run from automated
validation alone (`automated_only_score` in `microservice-backend`).

The score restricts both the earned points and the available points to the
auto-covered ones. A run of a case whose checklist is worth 70 points, 68 of
them backed by validators, reads 68/68 when every validator passes: full marks
on everything a machine can check, with the human-only points excluded rather
than failed.

The coverage set is read off the run's own `record.validation.debugScripts`
rather than off the case's declared items, because the item-level "is this point
automated" flag is not serialized onto a record. Each
[`DebugScriptResult`](/components/driver/validation/) carries the `item_id` (and
optional `sub_item_id`) forming the verdict id it backs:

- A script with decided verdicts contributes each as a synthetic `ReviewVerdict`
  and covers its id.
- A script that suffered a contract failure (`ran == false`) with no decided
  verdict fails the point it backs, and covers it.
- A script whose precondition went unmet is inconclusive. It is skipped entirely
  and contributes to neither the numerator nor the denominator, leaving the
  point for a human.

The covered items are then scored by the same `score_checklist` a human review
goes through, over the case's effective review items for the variant, common
plus variant with errata exclusions applied.

On a [validator-rated](/terminology/#validator-rated) case version, a completed
run whose validators decided no scored point scores zero over the declared
weight of every scored point, as it does on its own page, where it is rated
[`broken`](/testing/end-to-end/evaluation/#the-validator-decided-functional-rating).
It counts toward the arm's score and fails the pass rate. On any other version a
run with no covered point contributes to neither.

An arm's score is the mean fraction across its scored runs, reported with every
run's individual point. A run counts toward the arm's [pass
rate](/comparisons/statistics/) only when it earned every auto-covered point.

## Confound detection

The controls exist to keep the comparison fair, so the aggregation checks them
against what an arm's runs actually recorded and flags what slipped:

- harness and model, against the arm's own declaration. A gg arm declares
  neither, so its runs are checked for internal consistency instead.
- auth mode, for drift within the arm, since it is never declared.
- orchestrator, against the comparison's control.

Any mismatch is surfaced as a confound on the arm, with the distinct values
observed, and shown as a banner on the comparison.
