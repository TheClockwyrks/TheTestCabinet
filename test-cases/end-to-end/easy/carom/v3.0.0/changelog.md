## The debug surface is atomic, and the menus take a pointer

Every operation of the debug and automation surface now sets one field or one
fixed pair, places or removes one entity, reads the state, or moves the clock.
The two operations that took a partial object are gone, replaced by the scalar
operations they hid: a paddle's centre and its held velocity are set separately,
and a ball's position, velocity, spin, hold and hold timer each have their own
operation. `startMatch` and `serve` are gone as well; the sequences they
performed are assembled from atomic operations where a scenario needs them.

A paddle is taken from the player one side at a time, so a scenario that needs
the paddles under player control simply does not take them. The computer
opponent's sensing and its travel are separate, so it can be given its senses
while its body is held still. The obstacle clock's freeze is its own control
rather than a side effect of holding a paddle.

The world can be emptied and repopulated. A scenario clears the field and places
back only the ball and the obstacles it concerns, rather than leaving the rest
parked somewhere harmless.

A ball index belongs to the three-ball variant alone. Under the others the ball
operations take no index and the state reports none.

MENUS TAKE A MOUSE AND TOUCH as well as the keyboard. Moving a pointer onto an
item selects it, pressing and releasing inside one confirms it, and a press that
begins on one item and ends on another confirms nothing. A touch contact selects
where it lands and confirms where it lifts. The build reports each menu item's
hit region, so the layout stays the build's own.

Escape and `P` both open the pause menu, and either resumes it.

Returning to the title selects the entry that led away from it: leaving the
how-to screen lands on HOW TO PLAY, and quitting a match lands on the entry that
started it.

The game ships a showcase, and the checklist grades that it is there.

## Carom is a TypeScript project, on either of two engines

This version stops asking a model for a self-contained HTML page and asks it for
a real project instead. A run is seeded with a complete TypeScript workspace,
with Vite, `tsc`, ESLint, Prettier and Vitest already configured and an
`index.html` holding the canvas. How much of that project the model writes is
what the engine decides.

Under `simple-2d` the workspace also carries the case-owned modules around the
game, `src/constants.ts` and `src/main.ts`, and the model writes `src/game.ts`
against them. Everything the
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

## Every review point is decided by a validator

Every one of this version's review points names a **validator**: a TypeScript
test file under `validation/<engine>/`, one suite per engine for the same
scenario. Under `simple-2d` the suite runs by Vitest **in process**: it imports
the runtime and the build's own modules, stands the runtime up over an
`@napi-rs/canvas` canvas with a clock of its own, and steps it an exact number of
frames, reading behavior from the game's state, audio from the runtime's
`cue:played` event, and drawing from either pixel readback or a recording wrapper
around the 2D context. Under `none` the same scenario drives the built site in
headless Chromium through `window.__carom`, taking the game off real time with
`setAutoStep(false)` and stepping it with `advance`.

Either way a scenario asks for a number of frames and gets exactly that number, at
exactly the deltas it supplied. The `tick_hz` key is gone: each validator states
its own step by constructing its own clock, so a single case-wide rate could only
ever be wrong for some of them.

The debugging surface keeps `reset`, `snapshot`, and the control operations that
pose a scenario: `startMatch`, `serve`, `setScore`, `setPaddle`, `setBall`,
`setAiControl`, and gyre's `setObstacleClock`. Each speaks about Carom's own
world, which no runtime can know. `step`, `keyDown`, `keyUp` and `press` are gone
under both engines, since the runtime owns the actions. Under `simple-2d` the
engine owns the clock too, so `setAutoStep` is gone there; under `none` the build
still owns its clock, so the surface keeps `setAutoStep` and gains `advance`.

The build writes that surface under either engine; how it is reached is the
engine's. Under `simple-2d` the game's `initialize` returns it beside the state,
as `[state, debug]`, and the engine returns it from `engine.debug`. Under `none`
the build installs it on `window.__carom`.

## Under `simple-2d` the state is a value

The engine holds the game's state by value rather than as one object every
frame writes into. `update` is handed the current state as a read-only view,
`DeepReadonly<CaromState>`, and returns the next state; the engine keeps what it
returned, hands it to `render` read-only, and serves it from `engine.state`.
`src/game.ts` imports `DeepReadonly` from `ts-essentials`, which the seeded
`package.json` declares, and the state declaration in `specs/state.md` marks
every field and every array `readonly`. A frame therefore builds the next state
from the current one, and "rendering changes nothing" and "nothing but an update
advances the game" are what the compiler checks rather than what a comment asks
for. A diagnostic
source is called with the state current at the read for the same reason: a
source closing over the object `initialize` built would report the title screen
forever.

The debugging surface follows the same shape, since nothing may hold a writable
state. A pose takes the current state and returns the next — `serve(state)`,
`setBall(state, index, patch)` — and a caller applies it through the engine's
new `apply`, as `engine.apply((s) => debug.serve(s))`; a reading takes the state
and returns what it read, as `debug.snapshot(engine.state)`. `version` stays a
plain number. The `none` surface is unchanged: with no engine holding the state,
`window.__carom` still poses and reads the build's own.

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

## Appearance is the build's; behavior is exact

This version declares no `[[reference]]` views, no `[[proof]]` artifacts and no
`[[check]]` comparisons, and seeds no `specs/proof.md`. The fixed palette, the
monospace stack, the HUD coordinates, the tagline and the mode-label copy that
earlier versions fixed are gone from the specs and from the seeded
`src/constants.ts`: the overview now states only what must be visible — a dark
field, solid bodies that stand apart from it and from each other, a net, the two
scores and a mode label, a trail whose length is `speed * TRAIL_TIME`, and the
fixed title and menu copy. Under `simple-2d`, `src/game.ts` additionally exports
`BACKGROUND`, the field color `src/main.ts` hands the engine, so the build owns
the letterbox color too.

In exchange, every behavior a validator reads is stated exactly. The physics loop
is written out as the sub-step integration it is (`MAX_SUBSTEP`), with the spin
rotation, the decay, the wall rule, the circle-versus-rectangle rule with its
face-selection order, and the paddle's front-face placement. The paddle integrator
with its bound clamp, the human axis, the AI's target and deadzone rule
(`AI_HOME_DEADZONE` is now a named constant), the serve formula, the goal test,
the frame order on every screen, the menu edge order, the exact effect of every
menu item, and what starting a match and returning to the title reset are all
stated as rules. `SERVE_MAX_ANGLE` is gone, because the serve angle is exactly
`SERVE_ANGLE`. The overview also requires clean, maintainable code, written as for
a codebase shared with human developers.

## Every point is one behavior with a validator

Every review item carries a validation script, and descriptions state the
mechanically checked claim. Items that bundled several behaviors are split so a
build fails exactly the rule it breaks: `hit-edge` into `hit-top-edge` and
`hit-bottom-edge`, `no-tunnel` into `no-tunnel-obstacle`, `no-tunnel-paddle` and
`no-tunnel-wall`, `ui.trail` into `trail-length` and `trail-scales`. New points
cover what the rules already implied: `ai-homes`, `serve-angle`, the paddle
bounds, the obstacles' top and bottom faces, the two wall bounces, the sign of
spin's curve, spin surviving wall and obstacle bounces, a `navigation` category
for every menu transition, and a `hud` category for the two scores. `color` is
renamed `visibility`, since it checks a color distance rather than a palette.
The reviewer's judgement is the domain ratings; overriding a verdict is the
exception.

## The points `multi` moved

`v3.0.0` keeps the three variants: `base`, `gyre`, and `multi`, with three balls
on the field at once. In `multi` each ball is its own contest — its own hold, its
own launch at a fresh angle drawn over the whole circle, and its own respawn onto
a field that never stops for it — and the balls collide with each other, so
`multi` declares a fifth cue, `ball-bounce`, played once for the pair.

Those rules contradict points the case grades **commonly**. A scored point does
not return `multi` to a pre-serve countdown, since the other two balls carry on
and the field is never frozen; a hold belongs to a ball rather than to the match;
and a launch is aimed at nothing, so it has no direction to check. A variant may
only **add** to a common review item, never replace the validator behind one, so
six points left the common set: serve speed, countdown length, the two scoring
points, the match win and the deuce. `base` and `gyre` declare them in their own
files, beside the serve-direction points and the new `serve-angle`; `multi`
declares its own versions of the same six, worded for the rules it actually has.

`multi` keeps its own category, `multi-ball`, worth a point each for the three
balls on their own home points, the per-ball hold, the independent respawn, the
ball-to-ball collision, a waiting ball being solid and immovable, and the launch
angle being drawn over the full circle.

Only the engine-backed project differs by variant, so `multi` ships
`workspaces/multi/simple-2d` and shares `workspaces/none/` with the other two: the
engineless project holds no game code for a variant to differ in.

## Scoring

No domain was added, removed or renumbered. The checklist is larger than
`v2.1.0`'s and differently shaped: the points that moved out of the common set
for `multi` (serve direction and speed, countdown length, scoring, match win and
deuce) live in each variant's own file, `base` and `gyre` add `serve-angle`,
and the common set gains the split and new points above. Every point is decided
by its validator, and what a reviewer sees beside it is the replay or the frame
that validator captured.
