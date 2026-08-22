## Carom is a TypeScript project, on either of two engines

This version stops asking a model for a self-contained HTML page and asks it for
a real project instead. A run is seeded with a complete TypeScript workspace,
with Vite, `tsc`, ESLint, Prettier and Vitest already configured and an
`index.html` holding the canvas. How much of that project the model writes is
what the engine decides.

Under `simple-2d` the workspace also carries the case-owned modules the checks
read through, and the model writes `src/game.ts` against them. Everything the
specification fixes as a number has a name in `src/constants.ts`, and the specs
cite those names rather than restating the figures. The engine owns the frame
loop (which hands the game the real elapsed time of each frame, never a mandated
fixed timestep), keyboard input as named actions, audio as named cues, and the
debug overlay, so what stays the build's is the game.

Under `none` the workspace is that toolchain and nothing else: ten files at the
root, and no `src/` at all. The model writes every line of what runs: the frame
loop and its delta time, the canvas fit, input, audio, the diagnostics overlay,
the figures the specification fixes, the debugging surface the checks read
through, and the game itself.

## Two engines, one game

`v3.0.0` supports the engineless run and the [Simple 2D](/engines/simple-2d/)
engine, and the game is the same under both. What differs is the runtime
beneath it: `simple-2d` vendors it as a package at seed time, and `none`
supplies none at all, leaving the build to write the layer it needs.

Saying that takes a new way to name the starter project. A project is written
against a runtime: its `package.json`, its entry point, and whatever module
contract it fixes. One directory cannot stand for two engines. A `[workspaces]`
table names one directory per engine, and declaring it is the only way a case
may name an engine at all; a manifest keeping its single `workspace` key runs
engineless, which is what every other version is. The same rule reaches the
validators: a review
item names its suite relative to the engine's validator project
(`gameplay/serve-speed.test.ts`), and the case ships that suite in
`validation/none/` and `validation/simple-2d/` alike, so a point is decided the
same way whichever engine ran.

Because both projects deliver the same game, the review items, the domains and
the checks that decide them are the same across engines, and a score recorded
under one engine is comparable with a score recorded under the other. The specs
branch only where the runtime differs, and the two validator suites differ only
in how they stand a build up.

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
modules, stands the runtime up over an `@napi-rs/canvas` canvas with a clock of
its own, and steps it an exact number of frames. It reads behavior from the
game's state, audio from the runtime's `cue:played` event, and drawing from either
pixel readback or a recording wrapper around the 2D context.

Nothing drives a browser and no wall-clock time passes, so a scenario is
synchronous and reproducible: a check asks for a number of frames and gets exactly
that number, at exactly the deltas its clock supplied. The `tick_hz` key is gone
with the browser driver that read it — each validator states its own step by
constructing its own clock, so a single case-wide rate could only ever be wrong
for some of them.

The debugging surface keeps `reset`, `snapshot`, and the control operations that
pose a scenario: `startMatch`, `serve`, `setScore`, `setPaddle`, `setBall`,
`setAiControl`, and gyre's `setObstacleClock`. Each speaks about Carom's own
world, which no runtime can know. What they no longer sit beside are `step`,
`setAutoStep`, `keyDown`, `keyUp` and `press`: the runtime owns the clock and the
actions, so the build is not asked for them twice.

How that surface is reached is the engine's. Under `simple-2d` the case supplies
it already written, `initialize` hands it to the engine, and the engine returns
it from `engine.debug`. Under `none` the build writes it and installs it on
`window.__carom`.

## A reviewer's evidence is a replay of the build's own drawing

Almost every objective point declares a **replay**, and its validator produces
it. The recording comes from a draw-command recorder, a wrapper over the 2D
context that logs the operations a frame issued, frame by frame, alongside the
drawing state that frame inherited and the sprites, gradients and patterns those
operations draw with. A validator arms it, drives its scenario, disarms it, and
writes the recording out as JSON. Playing it back re-issues those operations
against a canvas, so what a reviewer scrubs is the build's own drawing rather
than a video re-shot from it. Every reference a frame makes resolves without any
earlier frame, so any frame is drawn on its own, which is what lets a build's
replay and the reference implementation's be scrubbed side by side in step.

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

## The third variant, and the points it moved

`v3.0.0` offers three variants: `base`, `gyre`, and `multi`, which returns with
three balls on the field at once. Each is its own contest — its own hold, its own
launch at a fresh angle drawn over the whole circle, and its own respawn onto a
field that never stops for it — and the balls now collide with each other, which
is a mechanic `base` does not have rather than a count that changed. A collision
between two balls is an event the other variants do not have, so `multi` declares
a fifth cue, `ball-bounce`, and plays it once for the pair.

Carrying it forward meant changing how the case is graded, because `multi`
contradicts points the case used to grade **commonly**. A scored point does not
return it to a pre-serve countdown, since the other two balls carry on and the
field is never frozen; a hold belongs to a ball rather than to the match; and a
launch is aimed at nothing, so it has no direction to check. A variant may only
**add** to a common review item, never replace the validator behind one, so six
points left the common set: serve speed, countdown length, the two scoring points,
the match win and the deuce. `base` and `gyre` now declare them, unchanged, in
their own files; `multi` declares its own versions of the same six, worded for the
rules it actually has. The serve-direction points had already moved this way, and
this is the same move for the same reason.

`multi` also brings a category of its own, `multi-ball`, worth a point each for
the three balls on their own home points, the per-ball hold, the independent
respawn, the ball-to-ball collision, a waiting ball being solid and immovable, and
the launch angle being drawn over the full circle.

Only the engine-backed project differs by variant, so `multi` ships
`workspaces/multi/simple-2d` and shares `workspaces/none/` with the other two: the
engineless project holds no game code for a variant to differ in.

## Scoring

The common checklist is unchanged in shape from `v2.1.0` where it is still
common, and no domain was added, removed or renumbered. What moved, moved without
changing what a variant is worth: the serve-direction points, and then the six
launch, hold and match-decision points above, left the common set for `base` and
`gyre`'s own files, and each variant still carries exactly the points it carried
before. `gyre` keeps its own three-point `gyre` category, and `multi` — which is
new here rather than carried over — is worth the common set plus its own six
multi-ball points, its own six gameplay points, and its `ball-bounce` cue. A score
recorded against `base` or `gyre` is therefore computed against the same checklist
that variant had before. What a reviewer sees beside a point has changed — the
reference mockups and the build's own proof captures are gone, and in their place
is the replay or the frame the point's own validator captured — but what the point
is worth, and what decides it, has not.
