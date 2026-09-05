## Coil is a TypeScript project, on any of three engines

This version asks for a real project rather than a self-contained page. A run is
seeded with a complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier
and Vitest already configured and an `index.html` holding the canvas. How much of
that project the model writes is what the engine decides.

`v2.0.0` supports the engineless run, the [Simple 2D](/engines/simple-2d/) engine
and the [Structured 2D](/engines/structured-2d/) engine, and the game is the same
grid serpent under all three. Under `none` the workspace is the toolchain and the
page and holds no source at all: the build writes the fixed-tick loop, the canvas
fit, keyboard input, audio, the diagnostics overlay, every figure the
specification fixes, and the debugging surface it installs on `window.__coil`.
Under either engine the workspace vendors the runtime as a package and carries two
case-owned modules around the game: `src/constants.ts`, which names every figure
the specification fixes, and `src/main.ts`, the browser entry. The build writes
`src/game.ts` — the state, the game itself, and the debug surface its `initialize`
returns. That module is seeded as a stub written against types the build has yet
to declare, so a freshly seeded workspace does not type-check, which is the
starting point rather than a broken seed.

Saying that takes a new way to name the starter project. A `[workspaces]` table
names one directory per engine, and a reference implementation is named the same
way, per engine, in each variant's own file. Because `src/constants.ts` carries
the mode — its menu entry, its HUD label, and the obstacle cells it lays — the two
modes need a starter project of their own under each engine, so the Maze variant
replaces that table with one of its own. The engineless project holds no game code
for a mode to differ in, so both share it.

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

Nothing is left to a reviewer to decide, so the points `v1.0.0` handed over
whole, the crisp board, the window fit, the produced sprite set and the produced
head bite, are re-cut as claims a validator can settle: a head sheet of four
frames that differ from one another, a body, corner and tail sprite that are three
different images at the size `specs/assets.md` fixes, a head cell and a body cell
painted by an image draw rather than by a shape, a bend painted with an image the
straight run is not, a bite that changes the head's painted frame on an eat and
returns it after `BITE_SECONDS`, four produced sounds that carry signal rather
than silence, an eat shorter than a tick, and a death longer than either of the
other two cues. The look of any of it is the presentation domain's aesthetic
rating, which now covers everything a player sees and hears rather than the
produced files alone.

The taxonomy is much finer than `v1.0.0`'s. Each wall is its own point, each
steering direction is its own point, each key bound to an action is its own point,
each screen transition is its own point in one direction, and each edge case the
rules imply, an update shorter than a tick, a third turn at a full buffer, the
last valid cell on a crowded board, a tail entered on a growth tick, a window read
at 27 ticks and again at 28, is a point of its own rather than a caveat in the
specification.

`validation/` holds one project per engine. The `none` suites drive the built site
in headless Chromium through `window.__coil`; the two engine projects run in
process against the vendored engine and reach the surface through `engine.debug`.
The three run the same scenarios and differ in how they reach the build.

The `tick_hz` key is gone. Coil is still clocked at a fixed 8 Hz, and each
validator now states its own step by constructing its own clock.

## Appearance is the build's; behavior is exact

This version declares no `[[reference]]` views, no `[[proof]]` artifacts and no
`[[check]]` comparisons, and seeds no `specs/proof.md`. A build is no longer given
screenshots to match, so the palette, the type and the look of the board and the
HUD are the build's, and how any of it looks is the presentation domain's
aesthetic rating. What the specs fix about appearance is legibility: a snake told
apart from the board and from the pellet, a head told apart from the body, and
the obstacles of the Maze board told apart from both.

In exchange, every behavior a validator reads is stated exactly, and each point on
the checklist is one observable behavior with one validator behind it.

## The specification is re-cut, and it branches on the engine

The seeded set is decomposed by concern into ten files. The scoring and the combo
leave the old `combo.md` for `scoring.md`, the mode leaves `gameplay.md` for
`mode.md`, the controls leave the UI file for `controls.md`, and `showcase.md`
joins the set. `overview.md`, `controls.md`, `ui.md`, `assets.md`,
`instrumentation.md` and `showcase.md` branch on the selected engine, so a run
reads only what its own runtime hands it and what it must write itself.

The best score is now the best of the session rather than a figure kept in browser
storage between sessions, and nothing persists between sessions. It still rises
live as the score passes it and still carries from one round to the next.

## The debug surface poses one thing at a time

The surface is rebuilt around the two rules a validator needs from it. Every
operation now sets a single field, reads the state, or moves the clock, so the
compound `startRound` is gone and a scenario is assembled from the calls it wants.
The keyboard operations are gone with it, because the keyboard belongs to the
runtime and a scenario about the controls dispatches a real key event.

The surface also owes a validator an isolated world. The pellet and, on the Maze
board, the obstacle cells are placed and removed outright, and the snake's
steering, its travel and the pellet's respawn are three switches a scenario holds
one at a time, so a check on the combo window can hold the snake still while the
ticks run. The highlight, the best score and the buffered turns join the state an
operation may pose, and the snapshot reports every field an operation can set.

## The points the two modes disagree on

A variant may only add to a common review point, never replace the validator behind
one. Three points mean different things in the two modes: what the board's interior
carries, the mode readout the HUD draws, and the entry the title menu opens with.
Those move out of the case manifest into both variant files, each stating its own
version against its own validator.

Maze keeps its own `maze` domain and the points that roll up to it: the fixed
course and its clear starting row, an obstacle fatal to the head, a pellet that
never lands on one, the two operations that clear and lay a course, and an
obstacle drawn on the cell it occupies rather than left as the empty field.

## A showcase for the catalog

Each variant ships a `showcase/<variant>/` directory: a description of the game as
a player meets it, and a carousel led by sustained real play captured from that
variant's reference build.
