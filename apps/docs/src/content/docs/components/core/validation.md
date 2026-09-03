---
title: Validation
---

## Overview

Validation is the automated pass over a finished implementation. It builds and
load-checks the produced tree, then decides the objective, mechanically
verifiable review points and synthesizes their evidence. A run under an
[engine](/components/core/engines/) decides those points with a vitest suite run
in process against the game the build produced. A run under no engine drives the
build's [instrumentation](/testing/end-to-end/instrumentation/) in a browser.

Validation assesses part of an implementation, not all of it. A game's feel and
quality are graded by a person playing the build and writing its
[review](/components/core/results/#reviews), which is where the run-wide
aesthetic rating comes from. What validation can decide, it decides: an
objective point backed by a validator is scored from that validator's result.
On a [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
verdicts decide the run's functional rating through each item's failure cap,
and a reviewer may override any of them, which folds into that review's own
figures. On a legacy run they are pre-filled into the reviewer's checklist and
overridable there, and the reviewer gives the functional rating.

## Load check

The most important automated check is whether the implementation runs at all.
Many failures are gross: the build fails, or the page throws on load and nothing
renders. Validation must:

- Build the implementation, running the test case's required `[build]` install
  and build commands from the produced repository, and serve its output
  directory (`dist/`, `build/`, or `out/`) as a static site.
- Load it in a headless browser.
- Detect fatal errors, including build failures and uncaught runtime errors that
  prevent the application from rendering.

A run that cannot load is the clearest possible signal and is recorded as such.

### The dependency install

The case's install command is run once per collected tree. The
[toolchain gate](#the-toolchain-gate) runs it ahead of validation so its commands
have their dependencies, and where that install succeeded validation reports the
recorded step as its own install result. A lockfile install rebuilds the dependency
tree from the lockfile, so running it a second time reproduces the state the first
one left.

Validation runs the install itself for any tree that carries no successful install of
that same command. `tcab validate` against an implementation directory is that case,
as is a tree whose earlier install failed. The summary reports the install as its own
step on both paths, so a reader sees one shape.

## Validators

A case that supports an [engine](/components/core/engines/) ships a validator per
verdict unit for that engine, written as a TypeScript test file and run by
vitest. Validators live with the case, are never seeded into the run workspace,
and run after the produced repository's dependencies are installed.

A validator runs in process. It imports the engine package directly, and it
imports the module the case requires the build to export its game from, so it
exercises the game the model wrote rather than a page serving it. The case's
module contract is what makes that import valid for every build.

A validator builds the engine itself: a canvas from `@napi-rs/canvas`, a clock
that supplies a scripted sequence of deltas, the engine's own initialization, and
an exact number of frames stepped one call at a time. A scenario therefore runs
synchronously and reproducibly, with no browser, no server, and nothing to wait
for. Setup runs the real game forward, so a validator poses a situation through
the game's own update and reads the outcome back from the state that update left.

Observation has three channels:

- The engine's own values: the game state, the frame counter and accumulated
  simulated time, and the viewport.
- The engine's events, which report each asset resolution and each cue played at
  the moment it happens.
- The canvas. Pixel readback decides what a frame actually drew, and a recording
  wrapper around the 2D context captures the draw-call stream where the calls
  carry the requirement more directly than the pixels do.

A validator is written against one engine's API and uses that engine's own
vocabulary, so a case supporting several engines ships a validator per verdict
unit per engine. A review item names its suite relative to the engine's validator
project, and the case ships that suite under `validation/<engine>/` for every
engine it supports. Resolution holds the declaration against each of them, so a
point is decided the same way whichever engine ran.

Each validator produces an auto verdict, decided from a list of assertions and
passing only when every assertion passed.

### Running the validators

The validators for the run's engine are a vitest project of the case's own,
separate from the build's. A case that ships one for the run's engine has its
points decided in process, and one that ships none has its build driven in a
browser instead. Whether the engine vendors a runtime does not enter into it: an
engineless project is TypeScript a suite imports exactly as an engine-backed one
is.

Deciding the run's points means running that project:

- Stage the case's `validation/<engine>/` directory into the collected tree at
  `validation/`. The sibling layout is what the case's project requires, since its
  config derives its root from its own location so a validator resolves the build's
  modules by the paths the build itself uses. Staging happens after everything that
  measures the code the model wrote has already measured it.
- Run vitest over that project from the implementation's repository root, naming
  the project's config explicitly so the build's own config is never the one that
  runs, naming **the suites this run's variant declares** as vitest's file filters,
  and reading the outcome from the JSON reporter written to a file.
- Reuse the dependency install the tree already carries, and install only a tree
  nothing prepared.

### Only the run's own variant's suites are run

A case ships one validator directory per engine, holding the suites of every
variant, because the variants share nearly all of them. That directory is a
superset of what any single run is rated on: a suite belonging to another variant
would fail against a build that was never asked to satisfy it — Carom's `gyre`
suites reach for a debug operation only `gyre`'s workspace seeds, so they fail
every `base` build for a reason that is not the build's.

The run is therefore scoped by the **checklist**, not by the directory. The
resolved variant's review items already name exactly the suites that decide its
points, and those staged paths are handed to vitest as its file filters, so a
suite no item of this variant names is never loaded — it costs nothing and reports
nothing. Nothing is asked of the case for this: the manifest's per-variant
checklist is the single declaration of which validators apply, and a
variant-specific suite is skipped by not appearing there. The same scoping applies
whether the validators are deciding a run's points or being run against a
reference implementation with `tcab validate --variant`.

If a variant is left with nothing to point vitest at, the run is refused outright
rather than run unfiltered — an unfiltered run is precisely the whole-directory
collection the filters exist to prevent — and every point is reported as not
having run.

Each test file maps back to the review point whose `validation` path declared it,
by the path the file was staged to. A file whose checks all passed earns its point
a passing verdict; a file with any failing check fails its point, and the verdict
records each failed check for the reviewer. A failure that states a comparison,
either a validator assertion helper's `Expected:`/`Actual:` lines or a chai
matcher's message, is stored as its real pair: the bound the check set as the
expected, the value the build produced as the actual. Any other failure is stored
as a bounded excerpt of its message. Stack frames are stripped before storage, so
file paths and line numbers never reach what a reviewer reads.

The whole suite run is capped at wall-clock minutes and the output retained per
suite at kilobytes, so a validator that never terminates costs the run the cap and
nothing more.

### The media a validator produces

A validator captures each output its verdict unit declares, in the form the
manifest gives it.

For a `replay` it arms the engine's draw-command
[recorder](/components/core/engines/#recording) once its scenario is posed,
disarms it once the behavior under test has happened, and writes what came back.
The evidence is therefore the operations the build itself issued over exactly
the stretch of the scenario the check is about, which nothing outside the suite
knows the bounds of.

For an `image` it encodes the surface as it stands, which is the frame that last
ran. That is the right form for a point about one picture rather than a stretch
of motion — which screen the game opened on, what colour it drew a paddle, where
the letterbox bars fell. A recording of a still screen would be the same frame
several hundred times over, and a reviewer looking at a menu wants to look at the
menu.

The runner creates the media directory before the suite run starts and names it
to the suites in an environment variable. Each suite writes its outputs into a
directory named by its own staged path, so two suites of the same name in
different directories cannot collide. Once the run returns, the runner moves
each declared output to the flat name every consumer of validation media
addresses and records whether it was there.

A recording is stored and served gzipped, as `<verdict>__<output>.json.gz`. A
frame names its inherited drawing state and its operations by index into tables
the whole recording shares, so any frame can be drawn on its own, which is what
seeking and side-by-side scrubbing are built on. Compression takes what
repetition remains down to a fraction of its size, so a run's whole set of
recordings costs a few megabytes. A recording is served as `application/json`
with `Content-Encoding: gzip`, so the browser inflates the body and the player
parses the document the recorder produced.

An output that is not there is recorded absent rather than failing anything. The
assertions decide the point and the media is the evidence beside the verdict, so
a suite that passed every check while failing to write its recording still
earns its point, and the reviewer sees that there is nothing to look at. A
capture that closed no frames is one of these: the file is left unwritten and
the output reported absent, which is the truthful reading of a section that drew
nothing. A recording is kept whatever the verdict was: a suite that failed its
checks is the one whose frames a reviewer most wants.

The baseline half is the same suites run against the variant's
`reference_implementation` for the same engine by
[`tcab capture-baselines`](/components/cli/overview/#commands), captured once
into `validation-baseline/<engine>/<variant>/` and served case-scoped. Same
suites, same scenarios, same form of output — so the difference a reviewer sees
on screen is a difference between the two builds and nothing else. Every frame
of a recording is drawable on its own, so the reviewer scrubs the build's
recording and the reference's in step.

## Checks

A check scores a screenshot of a driven view against a rendered reference
baseline and records the similarity with the run. Checks remain supported for the
case versions that declare them. A new case version decides its objective points
with validators instead, which reach the state a check would have to drive a
browser into and assert on it directly.

## Proofs

A proof is a screenshot or short clip the build writes to a known path as
evidence that a feature works. Validation records, for each declared proof,
whether the file turned up in the produced tree and is non-empty, judges no
proof's contents, and uploads each present proof when the run finishes to be
served back as per-run media (see
[run records](/components/core/run-records/)). A proof is informational, so a
missing one leaves the run's load result and status untouched. Proofs remain
supported for the case versions that declare them. A new case version captures
its media from its validators, which produce it from a scenario the case
controls.

## Instrumentation

A run under no engine decides its objective points by driving the case's required
[instrumentation](/testing/end-to-end/instrumentation/): the debug API the build
installs on a case-specific global, backed by a deterministic core. This is what
lets it check requirements a screenshot cannot. A script resets the build to a
known state, calls the case's control operations to set up a verdict's
precondition, steps the real simulation forward, and reads the outcome back from
a state snapshot and the rendered canvas.

A script runs per verdict unit, meaning a whole review item or an individual
sub-item, so each independently graded point gets its own script and its own
evidence. Each script produces an auto verdict exactly as a validator does, plus
the media outputs it declares. Media is captured from the model's build as the
actual result; the matching baseline is captured once by running the same script
against the case's reference implementation and is served case-scoped, so a
reviewer sees the two side by side.

### Validation that fails to complete

A validator or script that could be run but did not complete against a conformant
build fails the checklist point it backs. The case mandates the surface it drives,
so a missing module, a call that threw, a malformed return, or a declared output
the build never produced synthesizes a failed verdict for that point. A validator
suite that raised before running any check is this case: the module contract it
imports is one the case requires of every build. The verdict is recorded like any
auto verdict, and a reviewer may override it. The run itself stays reviewable: a
build that loads is scored down by exactly the points its checks could not
answer, and on a validator-rated run each such point applies its failure cap.

Three outcomes are held apart from that failure, and each leaves the point
undecided rather than synthesizing a verdict: an undecided point lowers no rating,
counts toward neither side of the score, and is left for a reviewer to decide. The
result records which of the three it was, so a reviewer reads the real reason a
point went undecided rather than one that sounds like a fact about the build.

The first is an unmet precondition. A setup often searches the model's own world
for a place to pose its scenario, such as a blind corner in an invented maze or a
legal build tile, and that search can come up empty against a fully conformant
build. A validator says this by skipping its checks: a suite whose checks were all
skipped reports an unmet precondition.

The second is a check that never ran. A validator project the run's engine has
none of, a tree with no vitest to run one, a suite the project does not contain,
or a report that could not be read are facts about the case or the produced tree.
Each is recorded with its reason and costs the build nothing.

The third is a run that exceeded its time budget. A case's validator suites are
capped as a whole, so a suite left waiting on something costs the run a bounded
amount of wall clock and no more, and the stopped suite's whole process tree goes
with it. The cap defaults to forty-five minutes and is set by
`TCAB_VITEST_TIMEOUT_SECS`. Crossing it is a fact about the host rather than about
the build, so every point the run left undecided records that the budget expired.
A score is a property of the build, and a host busy enough to stretch a conforming
build past a deadline must never turn that build into a failing one.

A point excluded from scoring for the version, through an
[erratum](/testing/end-to-end/manifests/) that links its verdict id, is still
driven and its media still captured, but a failed drive costs it nothing.

## The toolchain gate

A case declaring a
[`[toolchain]`](/testing/end-to-end/manifests/#the-typescript-toolchain) table has
its TypeScript commands run over the collected tree after the run's container is
gone, together with a smoke check that builds the implementation and opens it in a
headless browser. Each command's outcome and a bounded excerpt of its output are
recorded on the run record's own `toolchain` block, beside the validation summary.

A `typecheck` that ran and exited non-zero gates the run: its functional rating
is `broken` and its score zero, because code that does not compile is not
reviewable. The gate is applied where a run's functional rating and score are
derived, from its validators and reviews, so validator and reviewer verdicts
are stored as written. Every
other toolchain command is recorded and gates nothing, and a typecheck that
never ran leaves the run ungated.

The run stays reviewable. A gated run is published with its results and the
compiler output, and a reviewer may still play and score the build; the gate
decides the badge the run carries, not whether it can be judged.

## Results

Validation output is summarized into the [run
record](/components/core/run-records/) so the site can surface what validation
did. Building an implementation is reported as its constituent steps. The
dependency install and the static build are required steps that every run
performs, and each is reported as its own result with its outcome rather than
being folded into the load signal.

The summary therefore covers the install and the build alongside whether the
implementation loaded. It also carries:

- A validation result per verdict unit: the item and sub-item ids, the validator
  or script that ran, whether it ran and, when a negative answer was inconclusive,
  which of the three inconclusive outcomes it was, whether it gates, its auto
  verdicts and their assertions, and any captured outputs.
- A check result per declared check, carrying its display name as well as its
  view slug so the site can label it without re-deriving one.
- A proof result per declared proof: its id, display name, media kind, expected
  `dest`, and whether it was present.
- For a run of any other test type, that type's own result block in place of the
  end-to-end checks. An [asset-generation](/testing/asset-generation/overview/)
  run records the produced media, the recorded action log, and the operation
  count for its [asset kind](/testing/asset-generation/overview/#asset-kinds).
