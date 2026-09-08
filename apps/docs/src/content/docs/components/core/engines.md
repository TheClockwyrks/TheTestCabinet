---
title: Engines
---

## Overview

An engine is the runtime a produced game is built on. It owns the frame loop and
the delta time it hands the game, the input actions a player drives the game
with, the audio bus, the asset loader, and the on-screen diagnostics. Some
engines also own rendering and a gameplay framework of their own.

An engine is selected per run alongside the test case, variant, harness, and
model, and is recorded on the run. Selecting `none` gives the model no runtime at
all, which is the baseline every case supports.

Engines move the surfaces validation drives onto code the engine provides rather
than code the model writes, and they give a case a substantial existing codebase
to build against, so a run measures how well a model integrates with unfamiliar
code.

## Engine independence

An engine is independent of the test case. A case's specification describes the
game to build. An engine's documentation describes the engine and ships with the
engine, so a case never restates it. What a case states about the engine is
limited to the requirements genuinely specific to that game, such as which touch
layout to use and which actions to register beyond the layout's own.

Independence keeps engines clear of
[frozen versions](/development/frozen-versions/). A case version makes no claim
about the engine, so publishing a new engine version leaves every run recorded
against that case version intact. The engine is an input that varies between runs
of one case version, recorded the same way the harness version is.

A case declares which engines it supports and which versions of each, and a run
of that case is limited to that set.

## The engine catalogue

An engine is a directory under `engines/<slug>/` containing one manifest,
`engine.toml`, which declares:

- `slug`, the stable identifier, matching the directory name;
- `name` and `description`;
- `package`, the npm package providing the runtime;
- `docs`, the directory inside the package holding the engine's documentation.

The last two are declared by an engine that provides a runtime. An engine
without them supplies no runtime, which is what `none` is.

The built-in engines live under `engines/` in the repo, embedded into
`crates/core` at build time so a backend-driven worker with no checkout resolves
them the same way the CLI does. They are catalogued under
[Engines](/engines/overview/). The catalogue is closed: a run naming a slug
outside it is refused, because an engine is a staged package and a seeded
documentation tree the host has to hold.

An engine that carries a simulation core compiled to WebAssembly ships that
module prebuilt inside its package, so staging and seeding copy an engine's
artifacts rather than build them.

## Engine versions

An engine's version is the version of its staged npm package in the host package
store, read at seed time and recorded on the run. A change to an engine's
contract is published as a new package version, so the version recorded on a run
continues to identify exactly what that run was given. `none` supplies no runtime
and carries no version.

A case declares a version range for each engine it supports. The required minimum
is the earliest engine version the case's specification and its validators were
written against. The maximum, declared where a case needs one, pins the case to
the versions it was verified under. A range is unbounded above by default.

Both ends are enforced before work is spent. Resolving a case rejects a range it
could never admit an engine under. Selecting an engine for a run compares the
version the host would stage against the case's range and refuses a run outside
it before any container work begins. A case that declares a range the host has no
staged version to check against is refused the same way.

Resolution does not consult the host package store, so a case is listed, prompted
and reviewed on hosts that stage nothing, and a case pinned below the version the
store now holds stays resolvable.

## Delivery

An engine is staged into the same host package store as a case's
[packages](/testing/end-to-end/overview/#packages) and vendored at seed time into
`.vendor/engine/` inside the run repository, committed with the initial seed. The
seeded `package.json` has the dependency on that vendored copy written into it,
so the build imports the engine by its bare name as an ordinary installed
dependency. A case's own packages differ: the case declares them in its own
`package.json`, which the harness leaves as written.

## Documentation delivery

The engine's documentation directory is seeded into the run workspace at
`engine/`, so it is versioned with the engine and identical for every case. The
rendered prompt names the engine and points the build at that directory.

Reading that documentation is part of the work a run measures, so an engine
documents its own contract in the depth a model needs to build against it without
seeing its source.

## Validators hold the engine

A run under an engine decides its objective points with
[validators](/components/core/validation/) that hold the build they check. A
validator imports the engine and the build's own game module, constructs the
engine over a canvas and a clock of its own, and steps it an exact number of
frames.

Everything a check observes is therefore a value it already holds: the current
game state, the frame counter and the accumulated simulated time, the viewport,
the events the engine broadcast, the drawing context the game rendered through,
the stage canvas's pixels, and the recording. A build reaches a check through the
engine it was given, so a run under an engine publishes nothing to the page it is
drawn on.

## The debug surface

A case that drives its game from code fixes a debug surface: the operations that
pose a situation and read it back, expressed over the game's own state. The
game's `initialize` returns that surface beside the state it built, the engine
holds it and hands it back off its handle, and a validator reads it from the
engine it constructed.

An engine states the exact member names in its own documentation. The shape of
the surface belongs to the case rather than to the engine, so an engine holds
whatever the game gave it and makes no claim about what is in it.

Writing the surface is the build's own work, to the shape the case's
instrumentation spec states, so a build whose surface is missing or departs from
that spec fails the points a check behind it decides. That is the same rule
[instrumentation](/testing/end-to-end/instrumentation/) applies to every
model-implemented mechanism a verdict leans on.

## Recording

An engine records what a build drew, as an opt-in capture its owner arms and
disarms. A 2D engine records the drawing operations themselves, frame by frame,
and a player re-issues them against a fresh drawing surface to reproduce the
picture the build drew. A 3D engine records the rendered frames as VP9 video
timestamped in simulated time, and a player decodes it frame-exactly, so the
frame it shows is the one the build drew.

Either form lets a player seek to any frame at a bounded cost. A 2D frame carries
the drawing state it inherited beside what it submitted, so it is drawable
without the frames before it, and a 3D recording carries a keyframe at least
every 60 frames, so a frame decodes from the nearest earlier keyframe. Two
recordings of the same scenario are therefore comparable frame for frame, and
each engine's own page documents the exact format it writes.

Recording is bracketed by the caller rather than by the engine's lifetime, so a
validator captures the stretch of a scenario its check is about and the engine
accumulates nothing while the recorder is idle. The engine's own frame
preparation is inside the bracket and the debug overlay is outside it, so a
replayed frame reproduces the build's picture without the chrome drawn over it.

A validator emits a recording as the media of the review item its check backs,
declared as a `replay` output in the case's
[manifest](/testing/end-to-end/manifests/). The same suites driven against the
case's reference implementation produce the baseline recording, so a reviewer
compares what the build drew against what the reference drew.

### The images a recording draws

A 2D recording carries the bitmaps and pixel buffers its operations draw as
entries of a table the whole recording shares. An entry holds its pixels itself
or names a file beside the recording that holds them. An engine's recorder writes
the first form, since the recording it hands back is assembled in memory and
travels alone.

The writer that lands a recording in a run's
[validation media](/components/core/validation/#the-shared-image-store) rewrites
those entries into the second, so each unique image is written once per run under
a name derived from its own bytes. A sprite drawn in forty of a run's recordings
is then one file, it travels as PNG rather than as base64 inside a gzip that
cannot compress it, and opening one replay costs the images that replay draws
rather than the run's.

## The frame

The engine owns the frame loop and decides what each frame's delta time is worth.
A game integrates against the delta it is given, and a fixed timestep is the
game's own to build on top of that delta.

A clock is the object that answers what a frame is worth, supplied when the
engine is built and replaceable afterwards. Play installs a clock that reports
real elapsed time, and a check installs one that supplies a scripted sequence of
deltas. Running an exact number of frames is an engine operation, so a scripted
scenario runs synchronously and reaches the same states a reviewer watching the
build would.

Driving one scenario under several clocks and comparing the outcomes establishes
that a build integrates against the delta time it is given rather than against a
frame count. Those comparisons assert on outcomes that survive a legitimate
change in step size, such as whether an event occurred and what the resulting
state was. Numerical integration of a nonlinear system diverges across step sizes
even when the integration is correct.

## Input actions

A game registers named actions with the engine and binds them to inputs. The
engine owns the binding table, the key and pointer handling behind it, and the
on-screen controls a touchscreen needs.

A check drives a game by dispatching key events at the surface the engine listens
on, which reaches the binding table exactly as a player's keyboard does. The
engine resolves each action to a magnitude, so a check states what the player
did.

An engine defines a catalogue of named touch layouts, each carrying the action
vocabulary it lays out. A case names the layout its game uses, which in one
statement fixes both the on-screen controls and the set of actions a build is
expected to register. A game that needs actions beyond its layout's vocabulary
has those named by the case.

## Audio

A game plays audio through the engine's bus. The engine owns synthesis and
playback, mixing, mute, and the first-interaction unlock a browser requires
before audio may start.

The bus emits a semantic event for every cue a game plays. Subscribing to those
events establishes that a build played a cue in response to something that
happened.

## Assets

A game loads assets through the engine, giving it a path under a fixed asset
root. The engine resolves the path, loads the asset, and emits the outcome as an
event.

Subscribing to those events establishes which assets a build requested and which
resolved. The root is fixed and the loader belongs to the engine, so an asset
browser outside the running game reads the same tree.

## Diagnostics

The engine draws the debug overlay. A game registers the state it wants shown,
and the engine renders it, owns the toggle, and keeps it read-only.

## Rendering

An engine that owns rendering exposes it declaratively. A game configures what to
draw by attaching render components to its objects, and the engine's pipeline
draws them. Render modes such as wireframe, unlit, and normals are properties of
that pipeline, so every game an engine renders has them.

An engine that owns rendering also provides a path for a game to draw directly,
for cases where producing the rendering is part of what the case measures. A game
on that path implements the drawing itself and the engine calls it as part of the
frame. Render modes belong to the declarative pipeline, so a game that draws
directly supplies its own.

## Declaring supported engines

A test case version declares the engines it supports, each with the range of
engine versions it supports, in its manifest. A case that declares nothing
supports `none` alone. The
[manifest reference](/testing/end-to-end/manifests/) carries the grammar.

Every entry names a slug the engine catalogue knows and a well-formed version
range, both checked when the case resolves, before a run is spent. Once a version
declares any engine, its supported set is exactly what it declares, so a version
that runs under both a runtime and `none` lists both. A case declaring an engine
that provides a runtime ships a workspace `package.json`, because the engine
dependency is written into that file at seed time.

Support is declared per version. A case version gains engine support by adding a
new version, because its specification carries the statements that are specific
to running under an engine.

## Selecting an engine

An engine is selected per run and defaults to `none`. The CLI selects it with
`--engine`; every enqueue endpoint carries it on the launch body alongside the
harness, the model, and the orchestrator. A gg run carries it too, since a gg run
builds inside a seeded workspace like any other run.

The engine must resolve in the catalogue, must be one the case supports, and its
catalogued version must fall inside the range the case declared for it. A run
failing any of those is rejected before any container work begins. Both the
engine slug and the exact engine version are recorded on the run, the version
taken at seed time from the package store.

The resolved-version response carries the case's declared support set, so a
launcher offers exactly the engines the selected version supports and a host that
resolves a case over HTTP holds the same gate a host reading the manifest from a
checkout does.

## Showing a run its own inputs

A run's prompt and seeded specs are text rendered from the case version's
templates under the engine that run selected. Any surface that shows a run what
it was given renders from that run's own recorded case version and engine, so it
reproduces the files that run's harness received. A frozen version makes this
exact: the templates the rendering reads cannot have moved since the run.

A surface showing a case rather than a run defaults to the engineless rendering,
and every rendering a case version supports is reachable from it. The selection
lives in the URL, so the whole surface shows one selected coordinate.

A run's engine is part of what makes its result comparable. Runs of one case
under different engines measure different work and carry different available
points, so a comparison holds the engine constant and reports it as a confound
when it differs.
