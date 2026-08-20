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
