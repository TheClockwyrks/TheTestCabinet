## Coil is a TypeScript project, on any of three engines

This version asks for a real project rather than a self-contained page. A run is
seeded with a complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier
and Vitest already configured and an `index.html` holding the canvas. How much of
that project the model writes is what the engine decides.

`v2.0.0` supports the engineless run, the [Simple 2D](/engines/simple-2d/) engine
and the [Structured 2D](/engines/structured-2d/) engine, and the game is the same
grid serpent under all three. Under `none` the workspace is the toolchain and the
page: the build writes the fixed-tick loop, the canvas fit, keyboard input, audio,
the diagnostics overlay, every figure the specification fixes, and the debugging
surface it installs on `window.__coil`. Under either engine the workspace vendors
the runtime as a package and carries the case-owned modules around the game,
`src/constants.ts` and `src/main.ts`, and the build writes `src/game.ts` and the
debug surface its `initialize` returns.

Saying that takes a new way to name the starter project. A `[workspaces]` table
names one directory per engine, and a reference implementation is named the same
way, per engine, in each variant's own file.

The asset-production pass is the same under every engine. No engine supplies art
or sound, so every run still produces the snake's sprite set and the game's audio
with the binaries on the run image's `PATH`, and `specs/assets.md` is the one
contract for all three.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it is
installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. A non-zero `typecheck` rates the run broken.

## Every review point is decided by a validator

Every point on the checklist names a validator, and every point carries the
scoring domain it rolls up to and the failure cap it applies when it fails. The
validators decide the functional rating; a reviewer rates the run's aesthetics and
may override a verdict.

`validation/` holds one project per engine. The `none` suites drive the built site
in headless Chromium through `window.__coil`; the two engine projects run in
process against the vendored engine and reach the surface through `engine.debug`.
The three run the same scenarios and differ in how they reach the build.

The `tick_hz` key is gone. Coil is still clocked at a fixed 8 Hz, and each
validator now states its own step by constructing its own clock.

## Appearance is the build's; behavior is exact

This version declares no `[[reference]]` views, no `[[proof]]` artifacts and no
`[[check]]` comparisons, and seeds no `specs/proof.md`. A build is no longer given
screenshots to match, so the palette, the type and the drawing of the board and
the HUD are the build's, rated by a reviewer through the presentation domain. What
the specs fix about appearance is legibility: a snake told apart from the board and
from the pellet, a head told apart from the body, and the obstacles of the Maze
board told apart from both.

In exchange, every behavior a validator reads is stated exactly, and each point on
the checklist is one observable behavior with one validator behind it.

## The points the two modes disagree on

A variant may only add to a common review point, never replace the validator behind
one. Maze laces the board with a fixed course of fatal interior obstacles, so the
points about what the head may enter, where a pellet may land, and what the board
carries mean different things in the two modes. Those points move out of the case
manifest into both variant files, each stating its own version, and Maze keeps its
own `maze` domain and the four points that go with it.

## A showcase for the catalog

Each variant ships a `showcase/<variant>/` directory: a description of the game as
a player meets it, and a carousel led by sustained real play captured from that
variant's reference build.
