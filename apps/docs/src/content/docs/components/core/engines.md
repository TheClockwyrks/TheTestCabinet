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

Engines serve two purposes. They move the surfaces validation drives off code the
model writes and onto code the engine provides, which makes those checks
trustworthy. They also give a case a substantial existing codebase to build
against, so a run measures how well a model integrates with unfamiliar code
rather than only how well it starts from nothing.

## Engine independence

An engine is independent of the test case. A case's specification describes the
game to build. An engine's documentation describes the engine and ships with the
engine, so a case never restates it. What a case states about the engine is
limited to the requirements that are genuinely specific to that game, such as
which touch layout to use and which actions to register beyond the layout's own.

Independence is what keeps engines clear of
[frozen versions](/development/frozen-versions/). A case version makes no claim
about the engine, so publishing a new engine version leaves every run recorded
against that case version intact. The engine is an input that varies between runs
of one case version, exactly as the harness version does, and it is recorded the
same way.

A case declares which engines it supports, and a run of that case is limited to
that set. This is a compatibility gate rather than a description of the engine.

## Engine structure

An engine is a versioned package staged into the host package store and vendored
into the run repository at seed time, the same delivery path a case's
[packages](/testing/end-to-end/overview/#packages) use. The build imports it as an
ordinary installed dependency.

Engine versions are immutable. A published version is retained so that the
version recorded on a run continues to identify exactly what that run was given.
An engine change is published as a new version rather than as an edit to an
existing one.

An engine that carries a simulation core compiled to WebAssembly ships that
module prebuilt inside the package. The Rust toolchain is available only while a
run is live, so an engine's own artifacts are built before the engine is staged.

## Documentation delivery

An engine's documentation is seeded into the run workspace as part of the engine
package, so it is versioned with the engine and identical for every case. The
rendered prompt names the engine, states where its documentation is, and requires
the build to use it. The seeded documentation is surfaced on the run's Inputs tab
alongside the prompt, the seeded files, and the reference media.

Reading that documentation is part of the work a run measures. An engine
documents its own contract in the depth a model needs to build against it without
seeing its source.

## The host interface

An engine exposes a host interface that a driver binds to before any of the
build's own scripts run. Through it a driver replaces the engine's clock, drives
input actions, reads the audio and asset logs, and inspects the registered
diagnostic sources.

The host interface is engine-provided, so a driver that uses it depends on no code
the model wrote. This is what separates an engine run from the
[instrumentation](/testing/end-to-end/instrumentation/) contract. That contract is
model-written, so a build that implements it incorrectly fails the points its
instrumentation hides. An engine supplies the same control and inspection with
none of that exposure.

A case's own scenario setup still routes through code the model wrote, so the
[precondition guardrail](/testing/end-to-end/instrumentation/#the-precondition-guardrail)
continues to apply. A driver arranges a situation, the real systems run forward,
and the outcome is read back through an independent channel.

## The frame

The engine owns the frame loop and computes the delta time it hands the game. The
clock feeding that computation is a replaceable component: in normal play it is
the wall clock, and under a driver it is whatever schedule the driver supplies.

Because a driver chooses the schedule, delta-time independence is a property a
run can check directly. Driving one scenario under several schedules and
comparing the outcomes establishes that the build integrates against the delta
time it is given rather than against a frame count. The tick contract belongs to
the engine rather than to the case, so this check is engine-provided and runs for
every case.

Comparisons across schedules assert on outcomes that survive a legitimate change
in step size, such as whether an event occurred and what the resulting state was,
rather than on exact positions. Numerical integration of a nonlinear system
diverges across step sizes even when the integration is correct.

## Input actions

A game registers named actions with the engine and binds them to inputs. The
engine owns the binding table, the key and pointer handling behind it, and the
on-screen controls a touchscreen needs.

A driver reads the registered action set and drives actions directly. Reading the
set is a static inspection, so confirming that a build registered and bound every
expected action requires no simulated keystrokes.

An engine defines a catalogue of named touch layouts, each carrying the action
vocabulary it lays out. A case names the layout its game uses, which in one
statement fixes both the on-screen controls and the set of actions a driver
asserts were registered. A game that needs actions beyond its layout's vocabulary
has those named by the case.

## Audio

A game plays audio through the engine's bus. The engine owns synthesis and
playback, mixing, mute, and the first-interaction unlock a browser requires
before audio may start.

The bus records a semantic event for every cue a game plays. A driver reads that
log to establish that a build played a cue in response to an event, which
requires no knowledge of how the sound was produced.

## Assets

A game loads assets through the engine, giving it a path under a fixed asset root.
The engine resolves the path, loads the asset, and records the resolution.

A driver reads that log to establish which assets a build requested and which
resolved. Because the root is fixed and the loader belongs to the engine, an
asset browser outside the running game reads the same tree.

## Diagnostics

The engine draws the debug overlay. A game registers the state it wants shown, and
the engine renders it, owns the toggle, and keeps it read-only. A driver reads the
same registered sources the overlay draws from.

## Rendering

An engine that owns rendering exposes it declaratively. A game configures what to
draw by attaching render components to its objects, and the engine's pipeline
draws them. Render modes such as wireframe, unlit, and normals are properties of
that pipeline, so they are available to every game an engine renders without the
game implementing them.

An engine that owns rendering also provides a path for a game to draw directly,
for cases where producing the rendering is part of what the case measures. A game
on that path implements the drawing itself and the engine calls it as part of the
frame. Render modes belong to the declarative pipeline, so a game that draws
directly supplies its own.

## Modules

An engine may offer modules: subsystems a run turns on or off, so one engine
serves cases that want different amounts of game-agnostic work provided for them.
Collision is the clearest example. A case built around writing collision detection
runs with the module off, and a case whose difficulty lies elsewhere runs with it
on.

A module catalogue is closed. A run naming a module an engine does not ship is
rejected at launch, and a module that fails to resolve fails the launch rather
than falling back, so a run's recorded configuration always describes the run that
happened.

Module selections are made through named presets that a case declares support
for. The preset that produced a run is recorded with it, so results stay
attributable to an exact configuration.

## Declaring supported engines

A test case version declares the engines it supports with the manifest's
`engines` key. A run naming an engine outside that set is rejected when the case
resolves, before a run is spent.

Support is declared per version. A case version gains engine support by adding a
new version, because its specification carries the statements that are specific to
running under an engine.

## Selecting an engine

An engine is selected per run and defaults to `none`. Both the engine slug and the
exact engine version are recorded on the run, the version taken at seed time from
the package store.

A run's engine is part of what makes its result comparable. Runs of one case under
different engines measure different work and carry different available points, so
the engine keys a [coverage](/components/backend/coverage/) cell and a
[leaderboard](/components/site/overview/#leaderboard) row alongside the variant.
