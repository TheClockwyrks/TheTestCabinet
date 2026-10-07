---
title: "Comparison experiments"
---

A comparison is a saved, named experiment. It fixes the test every arm runs,
pits two or more configurations against each other as its arms, runs each arm
`N` times to smooth out variance, and gathers the arms' outcome distributions
and [diagnostics](/comparisons/diagnostics/). A comparison belongs to the
account that created it and is created and run from the web console. It is
[published](/comparisons/publishing/) read-only to the public site.

## The experiment model

A comparison is a set of configurations run against one held-constant test. The
stored shape is `ComparisonConfig` (`crates/core/src/comparison.rs`).

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

Cost is comparable only when the [auth mode](/components/core/run-records/)
matches, since an API-key run's dollar cost and a subscription run's dollar cost
do not mean the same thing. Auth mode is decided by the harness's own
credentials configuration rather than by whoever launches the run, so a
comparison reads it back off the runs: an arm whose runs disagree on
`RunEnvironment.auth_mode` is confounded. Every figure uses
`metrics.cost.comparable`, so a harness is neither rewarded nor penalized for
its billing model. See [metrics](/components/core/metrics/) for the token
classes and cost fields.

## Triggering the runs

A comparison reuses the existing launch paths rather than adding a run queue of
its own. Its "trigger missing runs" action tops each arm up to `N`, counting the
arm's runs that are in flight or that [count](#which-runs-an-arm-holds) toward
it. Before it launches, the action prunes the arm's recorded ids of runs that do
not count, so the stored configuration names only the runs the arm holds.

- A harness arm launches through the shared batch path, `launchBatch()` →
  `POST /jobs/batch` (`packages/ui/src/app/pages/runs/launchBatch.ts`), with the
  controls locked and one launch item per missing run.
- A gg arm launches through gg's own path, `launchGgRun` → `POST /gg/runs`, one
  request per run, with the arm's slot models bound onto the capability set it
  names.

A launch the backend refuses records nothing on the arm, and the console shows
the refusal's reason on the page.

### Which runs an arm holds

Runs are matched back to their arm by the ids the arm records at launch, not by
their [`RunSubject`](/components/core/run-records/) tuple. Two gg arms can share
a root model and differ only in capability set, which no run tuple
distinguishes, so an arm's membership is explicit.

A launch returns a job id, and the run its driver stores carries an id of its
own. The backend resolves each recorded id to the run it stands for by following
the job's `record_id`, and by following `retried_by` to the retry when the
backend retried the attempt, so an attempt and its retry are one run. An id
that already names a stored run resolves to that run.

A resolved run counts toward `N` by the rule that decides
[which runs count](/components/backend/coverage/#which-runs-count) toward a
coverage cell. A run that ends in the model's own failure counts, because the
model had its attempt. A run that ends `harness_error` or `infrastructure`, is
canceled, or was deleted does not count, and neither does a job that ended
without storing a run. The next trigger launches a replacement for each of them.

An arm's statistics, diagnostics and published runs are computed from its
counted runs. An arm reports the ids it holds, in flight or counted, as
`liveRunIds`, and the number of counted runs that have landed as `nObserved`.

### A complete comparison

A comparison is complete when every arm has `N` counted runs and none in
flight. The console then states that the comparison is complete in place of the
trigger action, and offers "Run again".

Run again starts a new round. It clears every arm's recorded ids and launches
`N` runs per arm. The previous round's runs stay stored as ordinary runs.

### Editing a comparison

An arm's launch identity is its harness and model, or its gg configuration and
slot models. Saving an edit (`PUT /comparisons/{id}`) compares each arm with the
stored arm of the same id, and the backend decides which recorded ids each arm
keeps:

- An arm whose launch identity is unchanged keeps its ids, so a run already in
  flight is not launched a second time.
- An added arm, and an arm whose launch identity changed, starts with no ids.
- A change to any control starts every arm with no ids.
- On a complete comparison, adding, removing or changing an arm starts every
  arm with no ids, so the edited comparison is run again as a whole.

Changing `N`, the name or the description keeps every arm's ids, and raising
`N` leaves the difference to the next trigger. A run an edit drops stays stored
as an ordinary run, and one still in flight runs to its end.

## Result computation

Only the configuration is stored. Every arm's statistics and diagnostics are
computed from its counted runs each time a comparison is read (`aggregate_comparison`,
`crates/core/src/comparison_aggregate.rs`), so a comparison always reflects
whatever runs have since landed.

The aggregation is deterministic for a given set of runs. An arm's runs are read
in sorted-id order, and the bootstrap is seeded from those ids, so the console
and the public snapshot show identical numbers and a recomputation never shifts
them.

The endpoints are per-account, attributed to the bearer token's account:

- `GET /comparisons` and `POST /comparisons`
- `GET`, `PUT`, and `DELETE` on `/comparisons/{id}`
- `POST /comparisons/{id}/publish`

A comparison is deleted from the console's comparison list and detail pages,
through the shared [confirmation dialog](/components/ui/overview/#dialogs).

## Automated-only scoring

A comparison generates dozens of runs, and the manual-review points are not what
a harness comparison measures, so a comparison scores each run from automated
validation alone (`automated_only_score`, `crates/core/src/comparison.rs`).

The score restricts both the earned points and the available points to the
auto-covered ones. A run of a case whose checklist is worth 70 points, 68 of
them backed by validators, reads 68/68 when every validator passes: full marks
on everything a machine can check, with the human-only points excluded rather
than failed.

The coverage set is read off the run's own `record.validation.debugScripts`
rather than off the case's declared items, because the item-level "is this point
automated" flag is not serialized onto a record. Each
[`DebugScriptResult`](/components/core/validation/) carries the `item_id` (and
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
