---
title: Terminology
---

## Artifact Service

The [artifact service](/components/artifacts/overview/) serves the produced run
trees — a run's playable build and its proof/asset media — off a persistent volume,
so they survive the ephemeral [driver](#driver) `Job`s that produced them. The
driver uploads each run's tree to it; a [console](#web-console) reads it from there
to play and review a run. It is a data-plane peer kept separate from the
[backend](#backend), so artifact bytes never transit the control plane.

## Attachment Pivot

A [part](#part)'s attachment pivot is the point — in its parent's local voxel
coordinates — at which it hangs off its parent in a [rig](#rig). Posing the parent
moves the child about this point, so a `turret`'s pivot is where it sits on the
`chassis` and a [joint](#joint) that rotates the turret turns it about (a pivot on)
that attachment. For the root part the pivot is its origin in world space. See
[Voxel binaries](/testing/asset-generation/voxel-binaries/).

## Auth Service

The [auth service](/components/auth/overview/) is the standalone private service
that holds The Test Cabinet's [user accounts](#user--account). It handles open
self-registration and password login and mints the opaque bearer tokens the
[backend](#backend) verifies on mutating run requests. It keeps its own database,
separate from the backend's, so credential storage stays out of the backend.

## Backend

The [backend](/components/backend/overview/) is The Test Cabinet's central private
service. It is the canonical source of test case definitions for runners and the
system of record for run results — stored, reviewed, and published. It does not
store credentials itself; it verifies the [auth service](#auth-service)'s bearer
tokens.

## Catalog

The term "catalog" is used to refer to The Test Cabinet's full set of test
cases.

## Climber

A climber is one [combination](#combination) enrolled on a
[ladder](#ladder) — the thing that actually does the climbing. Each climber's
progress is tracked **separately**, so a model added to a standing ladder starts at
[rung](#rung) one while the others carry on from wherever they had reached. Its
status is one of *climbing*, *awaiting review*, [*walled*](#wall), *held* (stopped by
hand), or [*topped out*](#topped-out). "Climber" and "combination" name the same
harness+model pair; the first is the role it plays on a ladder, the second is what it
is.

## Combination

A combination is one **harness + model** pair (plus a provider, for a
provider-routed harness) — the thing a run is executed *by*, as opposed to the test
case it is executed *on*. It is the unit a [coverage](#coverage) plan crosses with
its cases to form a cell, the unit a [ladder](#ladder) enrolls as a
[climber](#climber), and the unit a reusable coverage group holds. On a ladder a
combination is also called a climber.

## Coverage

"Coverage" carries two meanings in The Test Cabinet, and they are not the same
thing:

1. **The measurement.** How much of a declared matrix actually has runs: a
   **coverage plan** declares version-pinned test cases crossed with
   [combinations](#combination) and a target run count per cell, and its coverage is
   how many of those cells have met their target. This is the older and narrower
   sense. See [Coverage plans](/components/backend/coverage/).
2. **The feature area.** The reviewer scheduling surface as a whole — plans,
   [ladders](#ladder), the reusable groups both draw their members from, the
   account-wide [review buffer](#review-buffer), and the pause/halt controls. This is
   the sense in which the console has a Coverage section and the backend has a
   coverage API, and it includes ladders, which are *not* plans and do not aim at a
   matrix at all.

So "a ladder is part of coverage" and "a ladder has no coverage target" are both
true, in the two different senses. When it matters, say **coverage plan** for the
first and **the coverage surface** for the second. Neither sense has anything to do
with code coverage, which The Test Cabinet does not measure.

## Domain

A scoring domain is a facet of a test case the reviewer rates independently —
for example a game's single-player and versus modes. A case declares one or more
**common** domains that every variant is rated on, and a [variant](#variant) may
add its own domains, so the effective set a reviewer rates for a run is the common
domains plus that run's variant's own. The reviewer assigns a [rating](#rating) to
each while playing the build, and the run's **overall rating** is the *worst*
across that effective set, so a flawless mode cannot mask a broken one. A
[review item](#reviewer-checklist) may roll up to a domain, or stay general when
it applies to every mode.

## Dispatcher

The [dispatcher](/components/dispatcher/overview/) is a thin controller that drains
the [backend](#backend)'s run queue: it claims each queued run and creates one
Kubernetes `Job` running a [driver](#driver) to execute it. It is stateless (the
backend's job table is the source of truth) and replaces the earlier long-lived
worker pool, so concurrency scales with the cluster instead of a
hand-sized set of workers.

## Driver

The [driver](/components/driver/overview/) is the per-run executor: a one-shot
process, created by the [dispatcher](#dispatcher) as a Kubernetes `Job`, that runs
**exactly one** test case. It resolves the definition from the [backend](#backend),
drives the run through the [core](/components/core/overview/) (creating an untrusted
sandbox pod for the run), streams its live progress back to the backend, uploads the
produced tree to the [artifact service](#artifact-service), and exits. It is the
per-run-`Job` successor to the worker.

## Harness

In the context of The Test Cabinet, "harness" can refer to two elements:

1. The Test Cabinet itself
2. Agentic harnesses used to drive model(s)

The Test Cabinet handles running other harnesses. It does not directly hit LLM
APIs or implement an agentic loop. That responsibility lies entirely with the
agentic harnesses that The Test Cabinet uses to run the tests.

## Joint

A joint is one named **degree of freedom** on a [rig](#rig) [part](#part): a
rotation (radians about an axis through a pivot) or a translation (voxel units along
an axis), bounded by a `min`/`max`/`rest` range. Each joint is one of two kinds by
who drives it. A **caller-driven** joint takes its value from a consuming game at
runtime — the stable, game-facing control (for example `turret_yaw`). An
**auto-play** joint animates itself from a looping keyframe clip the viewer and a
game play back automatically. Joints are **model-invented**: a case does **not**
declare joints — the model devises whatever joints its rig needs to carry the
required animations. See
[Voxel models and rigs](/testing/asset-generation/overview/#the-rig-parts-and-joints).

## Ladder

A ladder is an ordered series of test cases that [climbers](#climber) ascend one
[rung](#rung) at a time, stopping at the first rung they cannot clear — so the rung a
model stops at *is* the result. Where a [coverage](#coverage) plan asks "have I run
this yet?" and treats its cells as an unordered set, a ladder asks "how far does this
model get?" and treats its steps as a sequence in which each is harder than the last.
Whether a climber advances is decided by the ladder's **gate**, a single rule
parameterised by a [rating](#rating) floor and a threshold. See
[Ladders](/components/backend/ladders/).

## Leaderboard

Each test case has a per-variant leaderboard ranking the models that have scored
runs of it. A model appears once, represented by its best-scoring run; the
ranking is by [score](#score) (points), not by rating.

## Model

Models are the large language models that determine the actions an agentic
harness takes.

## Orchestrator

An orchestrator decides how a run's [harness](#harness) sessions are conducted —
how many sessions to drive, what each is told, and when the work is done — while
the harness still owns each individual session. It is distinct from the
agentic harness (which performs the work of a single session) and from the
[runner](#runners)/[reporter](#reporters) component terms (which name The Test
Cabinet components that execute and report runs): an orchestrator is selected per
run, defaults to `one-shot` (a single session), and is harness-agnostic. See
[Orchestrators](/orchestrators/overview/).

## Part

A part is one named [voxel](#voxel) component of a [rig](#rig) — for example a
tank's `chassis`, `turret`, or `barrel`. Parts form a **parent/child hierarchy**,
each attached to its parent at an [attachment pivot](#attachment-pivot), and each is
sculpted independently (its own operation log and preview, targeted with
`voxel-anim --part <name>`). Posing a parent moves its children with it. Parts are
**model-invented**: the model creates each part at run time with `define-part` (a
case declares no parts) — the only rig contract a case fixes is its required
animations. See
[Voxel models and rigs](/testing/asset-generation/overview/#the-rig-parts-and-joints).

## Publishing

"Publishing" is the explicit gate that **releases** a [reviewed](#review) run and
flips it **public** — releasing its source (a public GitHub repo) and playable
build (Cloudflare Pages), and adding it to the public snapshot and gallery. It is
**refused unless the run has at least one [review](#review)**, so only assessed
runs reach the gallery. It is the second of two steps (review → publish); the
CLI's `tcab publish` is a solo convenience that does both at once (self-review and
publish). The release runs asynchronously in a per-publish `tcab-publisher` Job.
See [Results](/components/core/results/#lifecycle).

A produced run is stored on the backend privately as soon as it finishes (the
[driver](/components/driver/overview/) reports it) and its build is playable for
review off the [artifact service](/components/artifacts/overview/) — so there is no
separate operator "push" step; publishing is what first releases anything publicly.

## Rating

A rating is the reviewer's subjective quality tier for one [domain](#domain) of a
run — one of `flawless`, `great`, `passable`, `scuffed`, or `broken`. Each [review](#review)
carries one rating per domain. A run's **overall rating** is the worst (lowest)
across every domain of every review it has, so neither a flawless mode nor a
generous reviewer can mask a broken one.

## Reporters

Reporters are The Test Cabinet components capable of reporting run results. Only
GUI reporters allow users to interact with test case implementations. The
[Tauri desktop app](/components/tauri/overview/) and the
[web console](#web-console) are both reporters (and runners).

## Review

All runs are manually reviewed after the implementation is complete. This allows
the reviewer to assess how well a model matched the spec, check for any bugs, and
otherwise provide non-automated feedback about the run result. Reviews are
slightly subjective since games don't map cleanly to a rigid grading scale. A
review carries a per-domain [rating](#rating), a prose writeup, a verdict on each
[reviewer-checklist](#reviewer-checklist) item the case declares, and the identity
of the [account](#user--account) that wrote it. A run may carry **multiple
reviews — one per account** — typically from people other than the operator who
produced it; the verdicts and item [weights](#score) produce each review's
numeric score, which are then averaged across reviews for the run.

## Review Buffer

The review buffer is how many runs a [coverage](#coverage) plan or [ladder](#ladder)
is allowed to leave waiting on **you** before it stops enqueueing: everything in
flight, plus everything finished that you have not [reviewed](#review). The size is a
property of the reviewer (an account-wide setting, overridable per plan or ladder),
not of any one plan, because it describes how much work you want to come back to. It
exists so the first few reviews can still steer a plan — firing an entire matrix at
once spends the whole budget before anyone has looked at a single run. Refilling it
is called a **top-up**.

## Reviewer Checklist

A test case may declare a reviewer checklist: a list of major, observable
requirements that every reviewer must explicitly verify by playing the build.
Each item carries a point **weight**. An item may break into name-only
**sub-items**, each judged pass/fail on its own, with the item's weight split
evenly across them (partial credit for a section). The [consoles](#web-console)
present it as a guided review with a completeness gate — every item, and every
sub-item, needs a binary verdict (pass / fail) before a review can be saved or the
run published. The checklist is reporter-side and is never seeded, so it never
reaches the model.

## Rig

A rig is the posable structure of a [voxel-animation](#voxel) model: its named
[parts](#part) in a hierarchy, the named [joints](#joint) a consuming game drives
(so a game can pose the model at runtime — "rotate the turret to 37°"), and the
model-authored **animations** (named F-curve timelines — a walk, a recoil, an idle
— a game plays). The rig is **model-invented**: a case's `[model]` table declares
only the **required animations** (by name), the scoring targets, and the model
devises whatever parts and joints carry them. The produced `rig.json` carries
everything the model built. The
[voxel-runtime](/components/voxel-runtime/overview/) poses a produced rig for both
the review viewer and real games.

## Run Records

A run record is produced each time a test case runs to completion. This records
all information from the run, such as its run time, version information, and
token/cost data.

## Rung

A rung is one step of a [ladder](#ladder): exactly one test case, pinned to an exact
version and [variant](#variant), with an optional override of how many runs it takes
to judge. The rungs' order is the climb. Each rung carries a **stable opaque id**
rather than being identified by its position, because rungs get reordered and
re-pinned and every recorded verdict references that id — a positional identifier
would silently reattribute a [climber](#climber)'s history to a different case.

## Runners

The term "runner" refers to the component that actually executes a test case.
There is exactly one: the per-run [driver](#driver) a
[dispatcher](#dispatcher) creates for each run, built on the
[core](/components/core/overview/). The [CLI](/components/cli/overview/), the
[desktop app](/components/tauri/overview/), and the
[web console](#web-console) do not run test cases themselves — they **enqueue** a
run at the [backend](#backend) and watch it.

## Score

A [review](#review)'s score is its earned points over the points available: each
[reviewer-checklist](#reviewer-checklist) item is worth a `weight`, a `pass` earns
that weight and a `fail` earns none, and the total is the sum of every declared
item's weight. An item with **sub-items** instead earns the fraction of its weight
whose sub-items passed, so a review's earned score can be fractional. A run
carrying several reviews has a **score that is the average**
of its reviews' scores. The run's score is shown alongside its overall
[rating](#rating) and is what the per-case [leaderboard](#leaderboard) ranks on.

## Snapshot

A snapshot is the public export the [backend](#backend) produces from its
published results. The static [public site](/components/site/overview/) is built
from this snapshot, so the gallery keeps no live dependency on the backend.

## Test Case

Test cases provide the scenarios used for testing. Each test case represents
some isolated task that a harness/model must perform.

## Topped Out

A [climber](#climber) has topped out when it has cleared **every** [rung](#rung) of
its [ladder](#ladder): there is nothing left to climb, and the ladder has no further
question to ask of that [combination](#combination). It is the only one of the five
climber states that is nobody's move — the opposite end of the ladder from a
[wall](#wall), and distinct from *held*, which is a stop the reviewer chose.

## User / Account

A user account is a real, registered identity in the
[auth service](#auth-service), created by open self-registration with a username,
password, and display name. Logging in mints a bearer token that authenticates the
mutating run actions — [review](#review) and [publish](#publishing) — so every
review a run carries is attributed to the account that wrote it. Accounts are an
identity layer on top of the private network, not a replacement for it; reading
the gallery or the backend needs no account.

## Validation

The Test Cabinet leans on automated validation for everything it can check
honestly: that an implementation builds and loads, how well a view matches its
reference image, and — through the
[instrumentation](/testing/end-to-end/instrumentation/) a case requires the build
to expose — whether the spelled-out mechanics actually work when the build is
driven into the states that exercise them. A build that fails the mandated
debug-API contract fails automatically. What automation cannot judge honestly — a
game's feel and quality — is left to a human [review](/terminology/#review).

## Variant

Test cases may define multiple variants, which identify modifications to make to
the specifications provided as input for the test. These variants may change
game mechanics, add or remove content, and may noticeably affect the difficulty
of a test case.

## Voxel

A voxel is a single opaque-`#rrggbb` cell in a 3D grid — the 3D counterpart of a
pixel (there is no alpha). The two 3D
[asset-generation](/testing/asset-generation/overview/) kinds sculpt into a fixed
voxel volume, which always starts empty: `voxel-model` produces a
static model and `voxel-animation` produces a [rig](#rig) — named [parts](#part)
posed by named [joints](#joint). A voxel run's authoritative output is the data its
voxel binary **emits** — the meshed geometry (a per-part `.glb`) and a rendered
preview; the validator
parses and validates that emitted data rather than regenerating it, and the
frontend renders an interactive 3D model with three.js. See
[Voxel models and rigs](/testing/asset-generation/overview/#voxel-models-and-rigs).

## Wall

A wall is the [rung](#rung) a [climber](#climber) failed and therefore stopped at —
"walled at rung four" is a ladder's headline result for one model. It is a verdict the
gate computed from **your** [reviews](#review) of that rung's runs, so it is an
opinion rather than a fact about the model: a reviewer can promote a climber past a
wall by hand, and the automatic verdict is kept underneath rather than overwritten so
clearing the override restores exactly what the gate said. A failed or canceled
*job* is never a wall — infrastructure failures are retried, and only completed runs
are evidence.

## Web Console

The [web console](/components/web/overview/) is The Test Cabinet's
runner/reporter GUI running in a plain browser. It is the same console as the
[Tauri desktop app](/components/tauri/overview/), sharing its entire UI, but
delivered as a static web app. Like the desktop app, it **enqueues** runs at the
[backend](#backend) — which a [dispatcher](#dispatcher) drains into per-run
[driver](#driver) `Job`s — rather than running them itself. It is an operator
tool, served on the private network, not a public site.
