## Carom is a TypeScript project, on either of two engines

This version stops asking a model for a self-contained HTML page and asks it for
one module of a real project instead. A run is seeded with a complete TypeScript
workspace — Vite, `tsc`, ESLint, Prettier and Vitest already configured, an
`index.html` holding the canvas, and the case-owned modules the checks read
through — and the model writes `src/game.ts`. Everything the specification fixes
as a number now has a name in `src/constants.ts`, and the specs cite those names
rather than restating the figures.

The runtime that project stands on owns the frame loop (which hands the game the
real elapsed time of each frame, never a mandated fixed timestep), keyboard input
as named actions, audio as named cues, and the debug overlay. What stays the
build's is the game.

## Two engines, one game

`v3.0.0` supports the engineless run and the [Simple 2D](/engines/simple-2d/)
engine, and the game is the same under both. What differs is where the runtime
comes from: `simple-2d` vendors it as a package at seed time, and `none` has the
seeded project carry it as `src/host.ts`.

Saying that takes a new manifest format. A starter project is written against a
runtime — its `package.json`, its `src/main.ts`, and the module contract it fixes
— so one directory cannot stand for two engines. `format = 2` replaces the single
`workspace` key with a `[workspaces]` table naming one directory per engine, and
it is the only format that may declare an engine at all; a `format = 1` manifest
keeps its single `workspace` and runs engineless, which is what every frozen
version is. The same rule reaches the validators: a review item names its suite
relative to the engine's validator project (`gameplay/serve-speed.test.ts`), and
the case ships that suite in `validation/none/` and `validation/simple-2d/` alike,
so a point is decided the same way whichever engine ran.

Because the two projects fix the same module contract, the specs, the review
items, the domains and the validators are identical across engines, and a score
recorded under one engine is comparable with a score recorded under the other.

Each variant also ships a reference implementation per engine, under
`references/<engine>/<variant>/`, and the case's Reference tab offers a switch
between them.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it
is installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run.

## Objective points are decided by validators, not by a browser

Every one of this version's objective review points names a **validator**: a
TypeScript test file under `validation/`, run by Vitest **in process** against the
game the build produced. A validator imports the runtime and the build's own
`src/game.ts`, stands the runtime up over an `@napi-rs/canvas` canvas with a clock
of its own, and steps it an exact number of frames. It reads behavior from the
game's state, audio from the runtime's `cue:played` event, and drawing from either
pixel readback or a recording wrapper around the 2D context.

Nothing drives a browser and no wall-clock time passes, so a scenario is
synchronous and reproducible: a check asks for a number of frames and gets exactly
that number, at exactly the deltas its clock supplied. The `tick_hz` key is gone
with the browser driver that read it — each validator states its own step by
constructing its own clock, so a single case-wide rate could only ever be wrong
for some of them.

`window.__carom` keeps `reset`, `snapshot`, and the control operations that pose a
scenario — `startMatch`, `serve`, `setScore`, `setPaddle`, `setBall`,
`setAiControl`, and gyre's `setObstacleClock` — because each speaks about Carom's
own world, which no runtime can know. What they no longer sit beside are `step`,
`setAutoStep`, `keyDown`, `keyUp` and `press`: the runtime owns the clock and the
actions, so the build is not asked for them twice.

## A reviewer's evidence is a replay of the build's own drawing

Almost every objective point declares a **replay**, and its validator produces
it. The runtime — the vendored engine under `simple-2d`, the seeded `src/host.ts`
under `none` — carries a draw-command recorder: a wrapper over the 2D context that
logs the operations a frame issued, frame by frame, together with the context
state each frame inherited. A validator arms it, drives its scenario, disarms it,
and writes the recording out as JSON. Playing it back re-issues those operations
against a canvas, so what a reviewer scrubs is the build's own drawing rather than
a video re-shot from it — and because each frame carries the state it inherited,
any frame can be drawn without drawing the ones before it, which is what lets a
build's replay and the reference implementation's be scrubbed side by side in
step.

The arming is the point. A validator records the section of its scenario the
point is about and never the arrangement that got there: the paddle contact rather
than the half-second of approach posed in front of it, the point played out rather
than the match wound up to a deuce first. A section that runs long is thinned to a
frame budget rather than cut short, so a rally still reads as a whole rally.

Recording never decides anything. The check's assertions are untouched by it and
a point fails for exactly the reasons it failed before; a scenario that throws
still leaves behind what it recorded, because a failing check is the one whose
replay is worth the most. The handful of points where the thing being judged is a
single frame — a screen's layout, a color, the fit of the field in its window —
declare an image instead.

## Reference mockups and proof captures are retired

This version declares no `[[reference]]` views, no `[[proof]]` artifacts and no
`[[check]]` comparisons, and seeds no `specs/proof.md`. Every screen is left to
the model's design and graded by a person; the objective points are decided by the
validators above, which reach the state a check would have had to drive a browser
into and assert on it directly. Media for a reviewer is captured by the validators
from a scenario the case controls, rather than requested from the build — as
replays of the frames the build drew, and as single images where one frame is what
is being judged.

## The multi-ball variant is not carried forward

`v3.0.0` offers two variants, `base` and `gyre`. The `multi` variant of `v2.1.0`
is **not** carried forward, and this is a deliberate omission rather than an
oversight.

Multi's three independently-served balls contradict points this case grades
**commonly**, across every variant: a scored point does not return multi to the
pre-serve countdown ("the other two balls carry on uninterrupted, and the field is
not frozen"), and its launches are random over the full circle rather than aimed
at a receiver. The scoring, match-end and countdown points — and the validators
behind them — are written against base's single, globally gated, receiver-directed
serve. A variant may only **add** to a common review item, never replace the
validator behind one, so carrying multi forward means moving those points out of
the common set and declaring them per variant: a change to how the case is graded
rather than a port of the variant, and one that belongs to a version of its own.

`v2.1.0` still offers multi, is frozen, and still resolves, so every run already
recorded against it is unaffected.

## Scoring

The common checklist is unchanged in shape from `v2.1.0`: no common review item,
weight or domain was added, removed or renumbered, and the serve-direction points
moved from the common set onto `base` and `gyre` without changing what either
variant is worth. `gyre` keeps its own three-point `gyre` category. A score
recorded against a `v3.0.0` variant is therefore computed against the same
checklist that variant had before. What a reviewer sees beside a point has
changed — the reference mockups and the build's own proof captures are gone, and
in their place is the replay or the frame the point's own validator captured — but
what the point is worth, and what decides it, has not.
