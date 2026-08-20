## Carom is a TypeScript project built on the Simple 2D engine

This version stops asking a model for a self-contained HTML page and asks it for
one module of a real project instead. A run is seeded with a complete TypeScript
workspace — Vite, `tsc`, ESLint, Prettier and Vitest already configured, an
`index.html` holding the canvas, and the three case-owned modules the checks read
through — and the model writes `src/game.ts`. Everything the specification fixes
as a number now has a name in `src/constants.ts`, and the specs cite those names
rather than restating the figures.

The runtime is the [Simple 2D](/engines/simple-2d/) engine, declared as
`[[engine]] slug = "simple-2d"` with `min_version = "1.0.0"`. The engine owns the
frame loop (which hands the game the real elapsed time of each frame, never a
mandated fixed timestep), keyboard input as named actions, audio as named cues,
and the debug overlay. What stays the build's is the game.

## This version does not support the engineless run

Earlier versions of Carom ran under no engine at all, and `v3.0.0` does not. The
seeded workspace's `package.json` depends on the engine package, which only an
engine run vendors in, so an engineless run could not install — let alone build.
The manifest therefore declares `simple-2d` alone, and `none` is no longer folded
into a case's supported set once the case has declared an engine. Runs recorded
against `v2.1.0` and earlier are untouched: those versions are frozen and still
resolve, and still support the engineless run they were written for.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it
is installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run.

## Objective points are decided by validators, not by a browser

Every one of this version's objective review points names a **validator**: a
TypeScript test file under `validation/`, run by Vitest **in process** against the
game the build produced. A validator imports the engine and the build's own
`src/game.ts`, stands an engine up over an `@napi-rs/canvas` canvas with a clock
of its own, and steps it an exact number of frames. It reads behavior from the
game's state, audio from the engine's `cue:played` event, and drawing from either
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
own world, which no engine can know. What they no longer sit beside are `step`,
`setAutoStep`, `keyDown`, `keyUp` and `press`: the engine owns the clock and the
actions, so the build is not asked for them twice.

## Reference mockups and proof captures are retired

This version declares no `[[reference]]` views, no `[[proof]]` artifacts and no
`[[check]]` comparisons, and seeds no `specs/proof.md`. Every screen is left to
the model's design and graded by a person; the objective points are decided by the
validators above, which reach the state a check would have had to drive a browser
into and assert on it directly. Media for a reviewer is captured by the validators
from a scenario the case controls, rather than requested from the build.

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
checklist that variant had before, minus the reference and proof media a reviewer
used to see beside it.
