---
title: Validation
---

## Overview

Validation is the automated pass over a finished implementation. It builds and
load-checks the produced tree, then decides the objective, mechanically
verifiable review points and synthesizes their evidence. A run under an
[engine](/components/core/engines/) decides those points with a vitest suite that
imports the game the build produced, run in Node for a 2D engine and in a browser
page for a 3D one. A run under no engine drives the build's
[instrumentation](/testing/end-to-end/instrumentation/) in a browser.

Validation assesses part of an implementation. A game's feel and quality are
graded by a person playing the build and writing its
[review](/components/core/results/#reviews), which is where the run-wide
aesthetic rating comes from. An objective point backed by a validator is scored
from that validator's result. On a
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
verdicts decide the run's functional rating through each item's failure cap, and
a reviewer may override any of them, which folds into that review's own figures.
On a legacy run they are pre-filled into the reviewer's checklist and overridable
there, and the reviewer gives the functional rating.

## Load check

Validation must:

- Build the implementation, running the test case's required `[build]` install
  and build commands from the produced repository, and serve its output
  directory (`dist/`, `build/`, or `out/`) as a static site.
- Load it in a headless browser.
- Detect fatal errors, including build failures and uncaught runtime errors that
  prevent the application from rendering.

A run that cannot load is recorded as such. A tree whose dependency install
does not succeed is never built, and the run ends as an infrastructure failure.

### The dependency install

The case's install command is run once per collected tree. The
[toolchain gate](#the-toolchain-gate) runs it ahead of validation so its commands
have their dependencies, and where that install succeeded validation reports the
recorded step as its own install result.

Validation reuses the recorded install of that same command whatever it came
to, so a tree whose install failed is reported with that failure and never
built. Validation runs the install itself only for a tree that carries no
recorded install, such as `tcab validate` against an implementation directory.
The summary reports the install as its own step on both paths.

Every install is verified against the tree's lockfile. After the command exits,
each package the install would place on the host must be present on disk. A
package is one the install would place when the lockfile's dependency graph
reaches it from the project and its workspaces without passing through a package
the install leaves out. The install leaves out the dependency classes the
command itself omits, a package whose declared platform, architecture, or libc
family the host fails, an optional package whose declared node engine range the
host's node fails, every package that requires one of those unconditionally, and
every package reachable only through one of those. This is the rule npm's own
tree builder applies, so a healthy install always checks complete.

A command that exits non-zero, or exits zero and leaves such a package absent,
is run again after a delay, up to three attempts in all. A tree without a
lockfile, or with one that declares no packages, is accepted as unchecked.

The install succeeds when an attempt exits zero with every declared package
present. After the last attempt, a non-zero exit fails the install as a failed
command, and a zero exit fails it with a detail naming the packages still
missing. The install result records a bounded excerpt of its captured output and
the number of attempts it took. An install that fails on a run's collected tree
ends the run as an [`infrastructure`](/components/core/run-records/#status)
failure, since the model's output was never given a chance to build.

## Validators

A case that supports an [engine](/components/core/engines/) ships a validator per
verdict unit per engine that validator covers, written as a TypeScript test file
and run by vitest. Validators live with the case, are never seeded into the run
workspace, and run after the produced repository's dependencies are installed.
Every engine the case supports has a validator project of its own under
`validation/<engine>/`, and a review item names its suite relative to that
project.

A validator imports the engine package directly, and imports the module the case
requires the build to export its game from, so it exercises the game the model
wrote rather than a page serving it. The case's module contract is what makes
that import valid for every build.

A validator builds the engine itself over a canvas of its own, a 2D engine's from
`@napi-rs/canvas` in the test process and a 3D engine's from
`document.createElement("canvas")` in a headless Chromium page. The headless 2D
canvas resolves a build's fonts as a page would: a generic family such as
`monospace` or `sans-serif` resolves to the host's face for that role, and a
glyph the named faces lack falls through to a broad-coverage face the host
carries, so a mark a build draws as a symbol glyph reads as that glyph rather
than as the missing-glyph box. A validator supplies a
clock with a scripted sequence of deltas, runs the engine's own initialization,
and steps an exact number of frames one call at a time, so a scenario runs with
nothing to wait for. Setup runs the real game forward, so a validator poses a
situation through the game's own update and reads the outcome back from the state
that update left.

Observation has three channels:

- The engine's own values: the game state, the frame counter and accumulated
  simulated time, and the viewport.
- The engine's events, which report each asset resolution and each cue played at
  the moment it happens.
- What the engine drew: pixel readback from the canvas, a recording wrapper
  around a 2D context where the draw calls carry the requirement more directly
  than the pixels do, and, under a 3D engine, the retained scene, the camera's
  projection, the stage canvas's pixels, and the recording.

Every suite a validator project holds is named by a review item, so the files a
case ships and the points its checklist declares are one list. The shared harness
keeps its own tests with the harness, in the `@clockwyrks/case-harness` package
as `test/*.spec.ts` files.

A validation's `engines` key names the engines its validator decides its point
on. Absent or empty, the validator covers every engine the case supports.
Non-empty, it covers exactly the engines named, which is how a case scopes a
point that is the model's own work under one engine and the engine's work under
another. Each entry names an engine the case supports, a repeated slug is
rejected, and the key is legal only on the per-engine manifest format. Resolution
holds each declared script against the validator project of every engine its
validation covers, and against those alone.

A review point whose validator does not cover the run's engine is excluded from
that run's checklist entirely: undriven, unrecorded, unseen by the reviewer, and
carrying no weight in the score. Every graded point a run carries is decided by a
validator.

Each validator produces an auto verdict, decided from a list of assertions and
passing only when every assertion passed.

### Running the validators

The validators for the run's engine are a vitest project of the case's own,
separate from the build's. A case that ships one for the run's engine has its
points decided by that project, and one that ships none has its build driven
through its instrumentation in a browser. An engineless project is TypeScript a
suite imports exactly as an engine-backed one is.

The project's shape follows the engine. A 2D engine's project is a Node project:
its suites build the engine over a canvas of their own and step it in the test
process. A 3D engine's project runs in vitest browser mode on the runner's
headless Playwright Chromium: its suites run in the page, build the engine over a
canvas they create, and step it there, with Chromium rendering WebGL2 in
software. The Playwright Chromium is the one the runner's browser driver uses, so
a host without it fails the validation stage.

Deciding the run's points means running that project:

- Stage the case's `validation/<engine>/` directory into the collected tree at
  `validation/`. The case's project requires that sibling layout so a validator
  resolves the build's modules by the paths the build itself uses. Staging
  happens after everything that measures the code the model wrote has already
  measured it.
- Stage the shared validator harness beside it, at `validation/case-harness/`.
  The engineless validators of every case that has them are written over this one
  harness, which the repository holds as the `@clockwyrks/case-harness` package.
  It is TypeScript source vitest transpiles rather than a dependency the tree
  installs, so one import line resolves it both in the case's
  `validation/<engine>/` directory and in the staged project. It is read from the
  host package store the seeder vendors engine runtimes out of, with a
  repository-checkout fallback, and a host carrying neither leaves every point the
  validators back for the reviewer. A case may not declare it as a package, and
  nothing seeds it into a run repository.
- Run vitest over that project from the implementation's repository root, naming
  the project's config explicitly so the build's own config is never the one that
  runs, naming the suites this run's variant declares as vitest's file filters,
  and reading the outcome from the JSON reporter written to a file.
- Reuse the dependency install the tree already carries, and install only a tree
  nothing prepared.
- Remove the staged project once the run returns, whatever the outcome, so the
  tree is left as validation found it. A directory already standing at that name
  is held aside for the run and put back afterwards. The tree a run collects is
  published verbatim, and the tree `tcab validate` and `tcab capture-baselines`
  are pointed at is a case's committed reference implementation.

### Only the run's own variant's suites are run

A case ships one validator directory per engine, holding the suites of every
variant, so that directory is a superset of what any single run is rated on.

A run is therefore scoped by the checklist rather than by the directory. The
resolved variant's review items name exactly the suites that decide its points,
and those staged paths are handed to vitest as its file filters, so a suite no
item of this variant names is never loaded. The manifest's per-variant checklist
is the single declaration of which validators apply, and a variant-specific suite
is scoped out by not appearing there. The same scoping applies whether the
validators are deciding a run's points or being run against a reference
implementation with `tcab validate --variant`.

If a variant is left with nothing to point vitest at, the run is refused outright
rather than run unfiltered, and every point is reported as not having run.

Each test file maps back to the review point whose `validation` path declared it,
by the path the file was staged to. A file whose checks all passed earns its point
a passing verdict; a file with any failing check fails its point, and the verdict
records each failed check for the reviewer. A failure that states a comparison,
either a validator assertion helper's `Expected:`/`Actual:` lines or a chai
matcher's message, is stored as its real pair: the bound the check set as the
expected, the value the build produced as the actual. Any other failure is stored
as a bounded excerpt of its message. Stack frames are stripped before storage, so
file paths and line numbers stay out of what a reviewer reads.

The whole suite run is capped at wall-clock minutes and the output retained per
suite at kilobytes, so a validator that never terminates costs the run the cap and
nothing more.

### The media a validator produces

A validator captures each output its verdict unit declares, in the form the
manifest gives it.

For a `replay` it arms the engine's
[recorder](/components/core/engines/#recording) once its scenario is posed,
disarms it once the behavior under test has happened, and writes what came back.
The evidence is therefore what the build itself submitted to be drawn over
exactly the stretch of the scenario the check is about.

For an `image` it encodes the surface as it stands, which is the frame that last
ran. That is the form for a point about one picture rather than a stretch of
motion.

The runner creates the media directory before the suite run starts and names it
to the suites in an environment variable. Each suite writes its outputs into a
directory named by its own staged path, so two suites of the same name in
different directories cannot collide. Once the run returns, the runner moves each
declared output to the flat name every consumer of validation media addresses and
records whether it was there.

A `replay` takes one of two forms, decided by the engine that recorded it.

A 2D engine's recording is a draw-command recording, stored and served gzipped as
`<verdict>__<output>.json.gz`. Every frame carries the drawing state it
inherited, so any frame can be drawn on its own, which is what seeking and
frame-for-frame comparison require. A recording in this form is served as
`application/json` with `Content-Encoding: gzip`, so the browser inflates the
body and the player parses the document the recorder produced.

A 3D engine's recording is a frame recording: the frames the engine rendered, one
video frame per engine frame, encoded as VP9 in a WebM container and timestamped
in the engine's simulated time. The suite writes it as `<output>.webm` under its
staged path, the runner moves it to `<verdict>__<output>.webm`, and it is served
as `video/webm`. A player steps it frame by frame rather than playing it as a
clip, reaching any frame by its timestamp. The recording's frame count is the
length of the `frames` array the engine hands back beside the video bytes.

An output that is not there is recorded absent rather than failing anything. The
assertions decide the point and the media is the evidence beside the verdict, so
a suite that passed every check while failing to write its recording earns its
point. A capture that closed no frames is one of these: the file is left
unwritten and the output reported absent. A recording is kept whatever the
verdict was, since a suite that failed its checks is the one whose frames a
reviewer most wants.

The baseline half is the same suites run against the variant's
`reference_implementation` for the same engine by
[`tcab capture-baselines`](/components/cli/overview/#commands), captured once
into the version's `validation-baseline/<engine>/<variant>/` in cold storage and
served case-scoped. The same suites, scenarios and form of output make any
difference a reviewer sees a difference between the two builds. Both recordings
of a scenario are indexed the same way, a 2D frame by its place in the recording
and a 3D frame by its simulated-time timestamp, so a reviewer compares the
build's recording and the reference's frame for frame.

### Where baselines live

Baseline media is committed to the `cold-storage` submodule at the repository
root, not beside the case. Its tree mirrors the repository's, so a version's
baselines sit under the same path with `cold-storage/` in front:

```text
cold-storage/test-cases/<type>/<difficulty>/<slug>/<version>/validation-baseline/<engine>/<variant>/
```

Core's `ColdStorage::validation_baseline_dir` is the one resolver from a version
folder to that directory. The cold-storage root defaults to
`<checkout>/cold-storage`, and `TCAB_COLD_STORAGE_DIR` replaces it. The capture
commands write through the resolver and backend ingest reads through it.

Ingest copies each version's baselines into the stored version under
`validation-baseline/`, and the backend serves and snapshots them from the store.
A checkout without the submodule ingests every version with no baseline media.
A baseline is evidence beside a verdict and backs no point, so recapturing one
changes no score, including on a [frozen](/development/frozen-versions/) version.

### The shared image store

A draw-command recording's images are the bulk of its weight, and a run's
recordings draw the same sprites over and over. Each unique image is therefore
written once into the media directory as a flat file, `img.<id>.png`, and the
entry inside the recording names that file rather than carrying the bytes as
base64. The id is derived from the bytes themselves, so two recordings drawing
one sprite name one file and a re-publish writes the same names.

Only bitmaps are stored. The recording's other image kind is a raw RGBA pixel
buffer, and that one stays inline: RGBA is the most compressible payload a
recording carries, so the gzip the recording already lands under beats anything a
flat file could be served as. The format and the store's namespace admit a stored
buffer (`img.<id>.bin`), and a player resolves one.

Store files share the flat namespace declared outputs live in. Every declared
output's name carries `__` and a store file's name carries none, so the two can
never collide, and a store file travels the routes declared media already
travels: served by the per-run validation media route, published with the run and
with a case's committed baselines, and resolved in a console through the same
lookup that resolved the recording naming it. A console fetches the images one
replay draws rather than the run's, and the browser's own cache carries a sprite
across every replay a reviewer opens.

Both publish paths are driven off the run record's declared outputs. A store file
backs no verdict and appears on no record, so each path enumerates the media
directory for the store beside the outputs the record named.

The store is bounded, per recording, per page and per run. An image the writer
declines to store stays inline in the recording, and one it can neither store nor
carry is replaced by an opaque marker the player reports and skips, so a partly
drawn replay says which images are missing. The bounds are about the bytes a run
carries; the verdict and its assertions are decided by the checks alone. A suite
driven outside a run has no media directory, so every entry stays inline and the
recording travels alone.

## Checks

A check scores a screenshot of a driven view against a rendered reference
baseline and records the similarity with the run. A case version that declares
checks has them scored; a case version that ships validators decides its
objective points with them, which reach the state a check would have to drive a
browser into and assert on it directly.

## Proofs

A proof is a screenshot or short clip the build writes to a known path as
evidence that a feature works. Validation records, for each declared proof,
whether the file turned up in the produced tree and is non-empty, judges no
proof's contents, and uploads each present proof when the run finishes to be
served back as per-run media (see
[run records](/components/core/run-records/)). A proof is informational, so a
missing one leaves the run's load result and status untouched. A case version
that declares proofs has them collected; a case version that ships validators
captures its media from them, from a scenario the case controls.

## Instrumentation

A run under no engine decides its objective points by driving the case's required
[instrumentation](/testing/end-to-end/instrumentation/): the debug API the build
installs on a case-specific global, backed by a render-free core. A script
resets the build to a known state, calls the case's control operations to set up
a verdict's precondition, reconciles the build's readings with it, steps the
real simulation forward, and reads the outcome back from a state snapshot and
the rendered canvas.

A script runs per verdict unit, meaning a whole review item or an individual
sub-item, so each independently graded point gets its own script and its own
evidence. Each script produces an auto verdict exactly as a validator does, plus
the media outputs it declares. Media is captured from the model's build as the
actual result. The matching baseline is captured once by running the same script
against the case's reference implementation and is served case-scoped, so a
reviewer compares the two.

### The surface a recording binds to

The harness wraps every 2D context the page creates, and a recording binds to one
surface: the largest canvas attached to the document, which is the one the
reviewer is looking at.

A build that renders into an unattached canvas and blits the result onto the
attached one submits its drawing to the offscreen surface, so the attached
canvas's frames hold the blit alone. A recording therefore follows that blit.
When the candidate's last closed frame ended in a `drawImage` that covered the
whole of its backing store, drawn from another canvas the harness also wraps, the
recording binds to that source. Binding follows a single hop.

The blit has to be one that leaves nothing of the frame beneath it, and three
further conditions establish that. The source must have painted during the frame
in question, so a layer painted ahead of the frame is not followed. A canvas is
RGBA, so the blit must be `source-over` at full alpha or `copy`, leaving the
drawing beneath it replaced rather than overlaid. No clip may be in force, since
a whole-surface rectangle drawn into a small clipped inset covers the surface on
paper and a fraction of it on screen.

Each of the three cases these conditions exclude is a full-surface blit of a
wrapped canvas, and following one would answer a check with a surface the player
never looked at.

The observation is taken frame by frame from the arguments the build passed, and
frames go on being opened and closed on the attached candidate as well as on the
surface the recording bound to, so a build that stops compositing is answered by
the attached surface again on its next frame. The choice is settled when a
recording is armed and held until it is disarmed, so every frame of one recording
comes from one surface.

Binding to the surface the build drew into is what makes the operations a check
reads the build's own. A compositing build recorded off its attached canvas
submits a clear and a blit per frame while the pixel readback of that frame stays
correct, so a suite whose operation-based checks all fail while its pixel checks
pass has bound one surface too early.

### Validation that fails to complete

A validator or script that could be run but did not complete against a conformant
build fails the checklist point it backs. The case mandates the surface it
drives, so a missing module, a call that threw, a malformed return, or a declared
output the build never produced synthesizes a failed verdict for that point. A
validator suite that raised before running any check is this case, since the
module contract it imports is one the case requires of every build. The verdict
is recorded like any auto verdict, and a reviewer may override it. The run itself
stays reviewable: a build that loads is scored down by exactly the points its
checks could not answer, and on a validator-rated run each such point applies its
failure cap.

Three outcomes are held apart from that failure, and each leaves the point
undecided rather than synthesizing a verdict. An undecided point lowers no
rating, counts toward neither side of the score, and is left for a reviewer to
decide. The result records which of the three it was, so a reviewer reads the
real reason a point went undecided.

The first is an unmet precondition, which a validator states by skipping a check.
A setup often searches the model's own world for a place to pose its scenario,
and that search can come up empty against a fully conformant build. A setup that
drives the build in a browser skips for a second reason: the browser the project
started, the page it hands over and the file its own server answers with all
stand outside the build's influence. A suite whose checks were all skipped
reports an unmet precondition.

The second is a check that never ran. A validator project the run's engine has
none of, a tree with no vitest to run one, a suite the project does not contain,
or a report that could not be read are facts about the case or the produced tree.
Each is recorded with its reason and costs the build nothing.

The third is a run that exceeded its time budget. A case's validator suites are
capped as a whole, so a suite left waiting on something costs the run a bounded
amount of wall clock and no more, and the stopped suite's whole process tree goes
with it. The cap defaults to forty-five minutes and is set by
`TCAB_VITEST_TIMEOUT_SECS`. Crossing it is a fact about the host rather than
about the build, so every point the run left undecided records that the budget
expired and the build's score is left intact.

A point excluded from scoring for the version, through an
[erratum](/testing/end-to-end/manifests/) that links its verdict id, is still
driven and its media still captured, but a failed drive costs it nothing.

## The toolchain gate

A case declaring a
[`[toolchain]`](/testing/end-to-end/manifests/#the-typescript-toolchain) table has
its TypeScript commands run over the collected tree after the run's container is
gone, together with a smoke check that builds the implementation and opens it in
a headless browser. Each command's outcome and a bounded excerpt of its output
are recorded on the run record's own `toolchain` block, beside the validation
summary. The install command is the verified, retried
[dependency install](#the-dependency-install), and its record also carries the
number of attempts it took.

A `typecheck` that ran and exited non-zero gates the run: its functional rating
is `broken` and its score zero, because code that does not compile is not
reviewable. The gate is applied where a run's functional rating and score are
derived, from its validators and reviews, so validator and reviewer verdicts are
stored as written. Every other toolchain command is recorded and gates nothing,
and a typecheck that never ran leaves the run ungated.

The `test` command's results and coverage are read from the report files the
case's own build vitest config writes into the tree rather than from what the
command printed. The manifest's TypeScript toolchain states which files those are
and what a case configures to get them. They gate nothing either: a red suite and
thin coverage are recorded as facts about the build and left to validation and
the reviewer. They describe the tests the model wrote over the code the model
wrote, and never the case's validators, whose own suite has coverage disabled.

A gated run stays reviewable. It is published with its results and the compiler
output, and a reviewer may still play and score the build.

## Results

Validation output is summarized into the
[run record](/components/core/run-records/) so the site can surface what
validation did. Building an implementation is reported as its constituent steps.
The dependency install and the static build are required steps that every run
performs, and each is reported as its own result with its outcome rather than
being folded into the load signal. Each step records a bounded excerpt of its
combined output, which is also the detail a failed build reports, and the install
records the number of attempts it took.

The summary therefore covers the install and the build alongside whether the
implementation loaded. It also carries:

- A validation result per verdict unit: the item and sub-item ids, the validator
  or script that ran, whether it ran and, when a negative answer was inconclusive,
  which of the three inconclusive outcomes it was, whether it gates, its auto
  verdicts and their assertions, and any captured outputs.
- A check result per declared check, carrying its display name as well as its
  view slug.
- A proof result per declared proof: its id, display name, media kind, expected
  `dest`, and whether it was present.
- For a run of any other test type, that type's own result block in place of the
  end-to-end checks. An [asset-generation](/testing/asset-generation/overview/)
  run records the produced media, the recorded action log, and the operation
  count for its [asset kind](/testing/asset-generation/overview/#asset-kinds).
