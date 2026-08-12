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
the effective set for a run is the common domains plus its variant's. The
reviewer assigns a [rating](#rating) to each while playing the build, and the
run's overall rating is the worst across that effective set. A [review
item](#reviewer-checklist) may roll up to a domain, or stay general when it
applies to every mode.

## Driver

The [driver](/components/driver/overview/) is the per-run executor: a one-shot
process, created by the [dispatcher](#dispatcher) as a Kubernetes `Job`, that
runs exactly one test case. It resolves the definition from the
[backend](#backend), drives the run through the
[core](/components/core/overview/) in an untrusted sandbox pod, streams live
progress back to the backend, uploads the produced tree to the [artifact
service](#artifact-service), and exits.

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

A completed run needs at least one [review](#review) before it can be published.
Two waivers apply. A run in a publishable failure state (catastrophic, timed
out, harness error) has no checklist to complete. An auto-validated
[comparison](/comparisons/overview/) run carries automated verdicts in place of
a review.

A produced run is stored privately on the backend as soon as it finishes, and
its build is playable for review off the [artifact
service](/components/artifacts/overview/). Publishing is what first releases it
publicly. See [Results](/components/core/results/#lifecycle).

## Rating

A rating is the reviewer's subjective quality tier for one [domain](#domain) of
a run: `flawless`, `great`, `passable`, `scuffed`, or `broken`. Each
[review](#review) carries one rating per domain, and a run's overall rating is
the worst across every domain of every review it has.

## Reporters

Reporters are The Test Cabinet components capable of reporting run results. Only
GUI reporters allow users to interact with test case implementations. The [Tauri
desktop app](/components/tauri/overview/) and the [web console](#web-console)
are both reporters and [runners](#runners).

## Review

All runs are manually reviewed after the implementation is complete. The
reviewer assesses how well a model matched the spec, checks for bugs, and
provides the feedback automation cannot. Reviews are subjective, since games do
not map cleanly to a rigid grading scale.

A review carries a per-domain [rating](#rating), a prose writeup, a verdict on
each [reviewer-checklist](#reviewer-checklist) item the case declares, and the
identity of the [account](#user-account) that wrote it. A run may carry one
review per account, typically from people other than the operator who produced
it. The verdicts and item weights produce each review's numeric [score](#score),
which are averaged across a run's reviews.

## Reviewer checklist

A test case may declare a reviewer checklist: a list of major, observable
requirements that every reviewer verifies by playing the build. Each item
carries a point weight. An item may break into name-only sub-items, each judged
on its own, with the item's weight split evenly across them. A game-jam case
grades its items on a five-level scale instead of pass/fail.

The [consoles](#web-console) present the checklist as a guided review with a
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

## Runners

A runner is the component that actually executes a test case. There is exactly
one: the per-run [driver](#driver) a [dispatcher](#dispatcher) creates for each
run, built on the [core](/components/core/overview/). The
[CLI](/components/cli/overview/), the [desktop
app](/components/tauri/overview/), and the [web console](#web-console) enqueue a
run at the [backend](#backend) and watch it.

## Score

A [review](#review)'s score is its earned points over the points available. Each
[reviewer-checklist](#reviewer-checklist) item is worth a weight, a pass earns
that weight, and a fail earns none, so the total is the sum of every declared
item's weight. An item with sub-items earns the fraction of its weight whose
sub-items passed, so a review's earned score can be fractional. A run carrying
several reviews scores the average of its reviews' scores. The run's score is
shown alongside its overall [rating](#rating), and is what the per-case
[leaderboard](#leaderboard) ranks on.

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
mandated debug-API contract fails automatically. A game's feel and quality are
left to a human [review](#review).

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
runner/reporter GUI running in a plain browser. It is the same console as the
[Tauri desktop app](/components/tauri/overview/), sharing its entire UI,
delivered as a static web app. It enqueues runs at the [backend](#backend),
which a [dispatcher](#dispatcher) drains into per-run [driver](#driver) `Job`s.
It is an operator tool served on the private network, not a public site.
