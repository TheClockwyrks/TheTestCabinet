---
title: Terminology
---

## Artifact service

The [artifact service](/components/artifacts/overview/) serves the produced run
trees off a persistent volume: a run's playable build and its proof and asset
media. The [driver](#driver) uploads each run's tree to it, and a
[console](#web-console) reads it from there to play and review the run. It is a
data-plane peer of the [backend](#backend), so artifact bytes never transit the
control plane.

## Attachment pivot

A [part](#part)'s attachment pivot is the point, in its parent's local voxel
coordinates, at which it hangs off its parent in a [rig](#rig). Posing the
parent moves the child about this point, so a `turret`'s pivot is where it sits
on the `chassis`. For the root part the pivot is its origin in world space.

## Auth service

The [auth service](/components/auth/overview/) is the standalone private service
that holds The Test Cabinet's [user accounts](#user-account). It handles open
self-registration and password login, and mints the opaque bearer tokens the
[backend](#backend) verifies on mutating run requests. It keeps its own
database, so credential storage stays out of the backend.

## Backend

The [backend](/components/backend/overview/) is The Test Cabinet's central
private service. It is the canonical source of test case definitions for runners
and the system of record for run results through storage, review, and
publication. It verifies the [auth service](#auth-service)'s bearer tokens
rather than storing credentials itself.

## Catalog

The catalog is The Test Cabinet's full set of test cases.

## Climber

A climber is one [combination](#combination) enrolled on a [ladder](#ladder),
the thing that actually does the climbing. Within a ladder's dispatch each
climber's progress is tracked separately, and a climber is in one of four
states:

- **Running**: working its current [rung](#rung), which the dispatch can still
  launch.
- **Blocked**: its current rung is undecided and cannot progress until something
  is fixed, usually followed by a Retry. A dispatch with nothing in flight and
  only blocked climbers left to wait for reads Needs attention.
- **Failed**: it failed a rung and stopped there, so "failed at rung four" is a
  ladder's headline result for one model.
- **Completed**: it passed every rung, and the ladder has no further question to
  ask of that combination.

Climber and combination name the same thing: the first is the role it plays on a
ladder, the second is what it is.

## Combination

A combination is the thing a run is executed by, as opposed to the test case it
is executed on. It takes one of two shapes: a harness and model pair, plus a
provider for a provider-routed harness; or a
[gg configuration](/gg/configurations/) and a model for each launch slot that
configuration asks for. It is the unit a [coverage](#coverage) plan crosses with
its cases to form a cell, the unit a [ladder](#ladder) enrolls as a
[climber](#climber), and the unit a reusable coverage group holds.

## Coverage

Coverage carries three meanings in The Test Cabinet, and they are not the same
thing:

1. The measurement: how much of a declared matrix actually has runs. A coverage
   plan declares test cases pinned to a version, variant and engine, crossed
   with [combinations](#combination) and a target run count per cell, and its
   coverage is how many of those cells have met their target. A cell holds the
   first runs to land up to its target, and a run beyond that is not the plan's.
   This is the older and narrower sense. See [Coverage plans](/components/backend/coverage/).
2. The feature area: the reviewer scheduling surface as a whole, which is plans,
   [ladders](#ladder), the reusable groups both draw their members from, the
   account-wide [runs-in-flight limit](#runs-in-flight-limit), and the halt and
   stop controls. This is the sense in which the console has a Coverage section and
   the backend a coverage API, and it takes in ladders, which are not plans and
   aim at no matrix at all.
3. Code coverage: how much of a produced implementation's own `src/` the tests
   the model wrote reached when they ran. It is measured by istanbul while the
   case's [`[toolchain]` test
   command](/testing/end-to-end/manifests/#the-typescript-toolchain) runs, and
   recorded on the run record's `toolchain.test.coverage` block.

So "a ladder is part of coverage" and "a ladder has no coverage target" are both
true, in the first two senses. When it matters, say coverage plan for the first,
the coverage surface for the second, and code coverage for the third.

Code coverage shares only the word with the other two. It is a property of one
run's produced tree, it measures the model's own code with the tests the model
wrote, and the test case's validators contribute nothing to it because their own
suite has coverage disabled. The static analyzer's walk diagnostics on a run's
Code tab are headed Analysis notes rather than Coverage, since they describe the
analysis and measure nothing about the code.

## Dispatcher

The [dispatcher](/components/dispatcher/overview/) is a thin, stateless
controller that drains the [backend](#backend)'s run queue. It claims each
queued run and creates one Kubernetes `Job` running a [driver](#driver) to
execute it. The backend's job table is the source of truth, so concurrency
scales with the cluster.

## Domain

A scoring domain is a facet of a test case the reviewer rates independently,
such as a game's single-player and versus modes. A case declares common domains
that every variant is rated on, and a [variant](#variant) may add its own, so
the effective set for a run is the common domains plus its variant's. Each
domain carries a functional [rating](#rating), and the run's functional rating
is the worst across that effective set. A [review
item](#reviewer-checklist) names the domains its failure lowers on a
[validator-rated](#validator-rated) version, and on a legacy version may roll
up to a domain or stay general when it applies to every mode.

## Driver

The [driver](/components/driver/overview/) is the per-run executor: a one-shot
process, created by the [dispatcher](#dispatcher) as a Kubernetes `Job`, that
runs exactly one test case. It resolves the definition from the
[backend](#backend), drives the run through the
[core](/components/core/overview/) in an untrusted sandbox pod, streams live
progress back to the backend, uploads the produced tree to the [artifact
service](#artifact-service), and exits.

## Engine

In the context of The Test Cabinet, "engine" refers to two elements:

1. The [runtime a produced game is built on](/components/core/engines/), selected
   per run and recorded on it
2. The WebAssembly module a model submits for a
   [performance](/testing/performance/overview/) test case

The first is provided to a run and the second is the deliverable of one. A
performance case's engine is the artifact under test, so it is never selected and
a performance case supports no engine in the first sense.

## Failure cap

A failure cap is a review item's declared `failure_cap`: the highest functional
[rating](#rating) the item's `domains` may reach while the item's validator
fails, one of `broken`, `scuffed`, `passable`, or `great`. A domain's functional
rating is the lowest cap among its failing items, so the caps let the validators
decide the rating without a reviewer. Every item of a
[validator-rated](#validator-rated) case version declares one.

## Harness

In the context of The Test Cabinet, "harness" refers to two elements:

1. The Test Cabinet itself
2. Agentic harnesses used to drive models

The Test Cabinet runs other harnesses. It hits no LLM API and implements no
agentic loop; that responsibility lies entirely with the agentic harnesses it
drives.

## Joint

A joint is one named degree of freedom on a [rig](#rig) [part](#part): a
rotation in radians about an axis through a pivot, or a translation in voxel
units along an axis, bounded by a `min`/`max`/`rest` range. A caller-driven
joint takes its value from a consuming game at runtime, for example
`turret_yaw`. An `auto` joint is driven only by the model's animation tracks and
holds at its rest value otherwise. Joints are model-invented: a case declares
the animations its rig must carry, and the model devises whatever joints carry
them.

## Ladder

A ladder is an ordered series of test cases that [climbers](#climber) ascend one
[rung](#rung) at a time, stopping at the first rung they cannot clear, so the
rung a model stops at is the result. Where a [coverage](#coverage) plan asks
whether a cell has been run yet and treats its cells as an unordered set, a
ladder asks how far a model gets and treats its steps as a sequence in which
each is harder than the last.

A ladder is a configuration and does nothing by itself. Running it starts a
**dispatch**, which snapshots the configuration and climbs automatically: a
single gate, parameterised by a [rating](#rating) floor and a threshold, reads
the ratings the validators decided for the runs of each rung, and the backend
moves a climber to the next rung as soon as the gate clears. A dispatch counts
the runs that already exist for a rung, whoever launched them, and launches only
the runs the rung is missing. A ladder keeps only its latest dispatch. Every rung is a
[validator-rated](#validator-rated) case version, and reviews never move a climb.
See [Ladders](/components/backend/ladders/).

## Leaderboard

Each test case has a per-variant leaderboard over its scored runs. Each row is
one harness and model pairing, ranked by average [score](#score), then by
[rating](#rating), then by recency. gg runs are excluded, because a gg run's
agents may span several models.

## Model

Models are the large language models that determine the actions an agentic
harness takes.

## Orchestrator

An orchestrator decides how a run's [harness](#harness) sessions are conducted:
how many sessions to drive, what each is told, and when the work is done. The
harness still owns each individual session. An orchestrator is selected per run,
is harness-agnostic, and defaults to `one-shot`, a single session. See
[Orchestrators](/orchestrators/overview/).

## Part

A part is one named [voxel](#voxel) component of a [rig](#rig), for example a
tank's `chassis`, `turret`, or `barrel`. Parts form a parent/child hierarchy,
each attached to its parent at an [attachment pivot](#attachment-pivot), and
each is sculpted independently with `voxel-anim --part <name>`. Posing a parent
moves its children with it. Parts are model-invented: the model creates each
part at run time with `define-part`.

## Publishing

Publishing releases a [reviewed](#review) run and makes it public. It releases
the run's source to a public GitHub repo and its playable build to Cloudflare
Pages, and adds the run to the public [snapshot](#snapshot) and gallery. It is
the second of two steps, review then publish, and the release runs
asynchronously in a per-publish `tcab-publisher` Job. The CLI's `tcab publish`
performs both steps at once for a solo operator.

A completed [validator-rated](#validator-rated) run is publishable from the
moment it completes, on its functional rating and score. A completed legacy run
needs at least one [review](#review) before it can be published, with two
waivers. A run in a publishable failure state (catastrophic, timed out, harness
error) has no checklist to complete. An auto-validated
[comparison](/comparisons/overview/) run carries automated verdicts in place of
a review.

A produced run is stored privately on the backend as soon as it finishes, and
its build is playable for review off the [artifact
service](/components/artifacts/overview/). Publishing is what first releases it
publicly. See [Results](/components/core/results/#lifecycle).

## Rating

A run is rated on two channels, each a five-tier scale. The functional channel
is rated per [domain](#domain); the aesthetic channel is rated once for the
whole run.

The functional rating says how faithfully a domain implements the spec:
`flawless`, `great`, `passable`, `scuffed`, or `broken`, and a run's is the
worst across its domains. On a [validator-rated](#validator-rated) run the
validators decide each domain's rating from its failing items' [failure
caps](#failure-cap); a [review](#review) that overrides verdicts recomputes
those ratings for itself, and a run with reviews takes the worst effective
rating across them. On a legacy run each review carries one per domain and the
run's is the worst across every review.

The aesthetic rating says how the build looks, sounds, and feels to play:
`legendary`, `amazing`, `good`, `okay`, or `slop`. `amazing` is the normal
maximum and `legendary` is reserved for an exceptionally beautiful build. Only
a validator-rated run has one; each review carries a single run-wide tier and
the run's is the worst across every review. See
[Evaluation](/testing/end-to-end/evaluation/#rating-channels).

## Reporters

Reporters are The Test Cabinet components capable of reporting run results. Only
GUI reporters allow users to interact with test case implementations. The [web
console](#web-console) is both a reporter and a launcher of
[runs](#runners).

## Review

A review is a person's assessment of a run after playing its build, providing
the feedback automation cannot. Reviews are subjective, since games do not map
cleanly to a rigid grading scale.

A review carries a prose writeup, a [rating](#rating), and the identity of the
[account](#user-account) that wrote it. On a
[validator-rated](#validator-rated) run the rating is a single run-wide
aesthetic tier, and the review may also override individual
[reviewer-checklist](#reviewer-checklist) verdicts the validators decided. On a
legacy run the rating is the functional one per domain, the review also carries
a verdict on each reviewer-checklist item the case declares, and those verdicts
and item weights produce the review's numeric [score](#score), averaged across
the run's reviews. A run may carry one review per account, typically from
people other than the operator who produced it.

## Reviewer checklist

A test case may declare a reviewer checklist: a list of major, observable
requirements that every reviewer verifies by playing the build. Each item
carries a point weight. An item may break into name-only sub-items, each judged
on its own, with the item's weight split evenly across them. A game-jam case
grades its items on a five-level scale instead of pass/fail.

On a [validator-rated](#validator-rated) run the validators decide every
verdict, and a [review](#review) may override any point's verdict with a binary
pass or fail and an optional note. Points a review leaves untouched keep the
validators' verdicts, so a review's effective checklist is the validators'
verdicts overlaid with its overrides. Overriding is the exception, for a
validator whose precondition could not be met or a build that does the right
thing despite broken instrumentation. On a legacy run the
[web console](#web-console) presents the checklist as a guided review with a
completeness gate: every item and sub-item needs a verdict before a review can
be saved or the run published. The checklist is reporter-side and is never
seeded, so it stays out of the model's input.

## Rig

A rig is the posable structure of a [voxel-animation](#voxel) model: its named
[parts](#part) in a hierarchy, the named [joints](#joint) a consuming game
drives, and the model-authored animations those joints carry. The rig is
model-invented: a case's `[model]` table declares the required animations by
name, and the model devises whatever parts and joints carry them. The produced
`rig.json` carries everything the model built, and the
[voxel-runtime](/components/voxel-runtime/overview/) poses it for both the
review viewer and real games.

## Run records

A run record is produced each time a test case runs to completion. It records
all information from the run, such as its run time, version information, and
token and cost data.

## Rung

A rung is one step of a [ladder](#ladder): exactly one test case, pinned to an
exact version, [variant](#variant), and engine, with an optional override of how
many runs it takes to judge. The rungs' order is the climb. Each rung carries a
stable opaque id rather than being identified by its position, because rungs get
reordered and every job a dispatch launches references that id.

A climber passes or fails each rung it reaches. A failed rung is the result the
gate computed from the validator ratings of that rung's runs, and the validators
are assumed correct, so it stands as the climber's result for that version of
the case. An infrastructure failure or a canceled run never fails a rung,
because neither says anything about the model. A run that ended on the model's
own failure, such as a timeout or a harness error, counts as a broken run.

One climber on one rung is a **rung slot**, the unit a ladder's rung counts are
reported in: three climbers on four rungs are twelve rung slots.

## Runners

A runner is the component that actually executes a test case. There is exactly
one: the per-run [driver](#driver) a [dispatcher](#dispatcher) creates for each
run, built on the [core](/components/core/overview/). The
[CLI](/components/cli/overview/) and the [web console](#web-console) enqueue a
run at the [backend](#backend) and watch it.

## Runs-in-flight limit

The runs-in-flight limit is how many of a [coverage](#coverage) plan's or a
[ladder](#ladder) dispatch's own jobs may be queued, pending, dispatched,
starting, or running at once. It exists so one plan or ladder shares the global
queue fairly with everything else waiting on it. It is an account-wide setting
overridable per plan and per ladder, and is either a bound or no limit, which
launches every missing run at once. Completed runs never occupy it.

## Score

A score is earned points over the points available. Each
[reviewer-checklist](#reviewer-checklist) item is worth a weight, a pass earns
that weight, and a fail earns none, so the total is the sum of every declared
item's weight. An item with sub-items earns the fraction of its weight whose
sub-items passed, so an earned score can be fractional. A
[validator-rated](#validator-rated) run scores from its validators' verdicts
the moment it completes; each of its [reviews](#review) scores from its
effective checklist, and a run with reviews scores the average of them. A
legacy run scores per review and a run carrying several reviews scores the
average. The run's score is shown alongside its functional [rating](#rating),
and is what the per-case [leaderboard](#leaderboard) ranks on.

A [comparison](/comparisons/experiments/) scores a run from its automated
validators alone, restricting both the earned points and the available points to
the machine-checkable ones.

## Snapshot

A snapshot is the public export the [backend](#backend) produces from its
published results. The static [public site](/components/site/overview/) is built
from this snapshot, so the gallery keeps no live dependency on the backend.

## Test case

Test cases provide the scenarios used for testing. Each test case represents an
isolated task that a harness and model must perform.

## User account

A user account is a real, registered identity in the [auth
service](#auth-service), created by open self-registration with a username,
password, and display name. Logging in mints a bearer token that authenticates
the mutating run actions, [review](#review) and [publishing](#publishing), so
every review a run carries is attributed to the account that wrote it. Accounts
are an identity layer on top of the private network. Reading the gallery or the
backend needs no account.

## Validation

Automated validation checks everything a machine can check: that an
implementation builds and loads, how closely a view matches its reference image,
and, through the [instrumentation](/testing/end-to-end/instrumentation/) a case
requires the build to expose, whether the spelled-out mechanics work when the
build is driven into the states that exercise them. A build that fails the
mandated debug-API contract fails automatically. Each validator's pass or fail
is visible per checklist point on a run's Verdict tab, to every visitor
including the public gallery. A game's feel and quality are left to a human
[review](#review).

## Validator-rated

A case version is validator-rated when it is on the engine-supported manifest
format, the `[workspaces]` / `engines` / `[[engine]]` spelling of its starter
project, and is not a game jam. A run is validator-rated when its case version
is. Its validators decide its functional [rating](#rating) and [score](#score)
at completion, so it is publishable with no review, and those figures stand
while the run has none. Its reviewers supply a single run-wide aesthetic rating
and may override individual checklist verdicts, and a run with reviews averages
their effective scores and takes their worst effective functional rating. Every
other version is a legacy version, whose reviewers supply the functional rating
and checklist verdicts.

## Variant

Test cases may define multiple variants, which identify modifications to make to
the specifications provided as input for the test. These variants may change
game mechanics, add or remove content, and may noticeably affect the difficulty
of a test case.

## Voxel

A voxel is a single opaque-`#rrggbb` cell in a 3D grid, the 3D counterpart of a
pixel. The two 3D [asset-generation](/testing/asset-generation/overview/) kinds
sculpt into a fixed voxel volume, which always starts empty: `voxel-model`
produces a static model, and `voxel-animation` produces a [rig](#rig).

A voxel run's authoritative output is the data its voxel binary emits: the
meshed geometry as a per-part `.glb`, and a rendered preview. The validator
parses and validates that emitted data rather than regenerating it, and the
frontend renders an interactive 3D model with three.js.

## Web console

The [web console](/components/web/overview/) is The Test Cabinet's
runner/reporter GUI, delivered as a static web app that runs in a plain browser.
It mounts the routed application from the [UI
library](/components/ui/overview/). It enqueues runs at the [backend](#backend),
which a [dispatcher](#dispatcher) drains into per-run [driver](#driver) `Job`s.
It is an operator tool served on the private network, not a public site.
