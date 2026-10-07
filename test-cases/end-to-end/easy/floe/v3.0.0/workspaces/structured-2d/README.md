# Floe — starter project

This repository is the starting point for building **Floe**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine,
which is installed as an ordinary dependency and documents itself under
`engine/` — read that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

**`src/game.ts` does not exist yet, and that is the starting point.**
`src/main.ts` imports `BACKGROUND` and `game` from it, so a freshly seeded
workspace fails `npm run typecheck` on the missing module. Create the file.

Start by declaring and exporting `FloeState`, exactly as `specs/state.md` fixes
it: a class extending the engine's `GameState`. Export `FloeDebugApi` too, the
debug and automation surface `specs/instrumentation.md` specifies.

`src/game.ts` then exports `game`, a `GameDefinition<FloeDebugApi>`: the game
instance class, a level registry holding the single level the game runs in
(`LEVELS` in `src/constants.ts` names it), and `startLevel` naming it. The engine
opens that level once and the game never opens another — every screen is a value
of the state's `screen` field, so the world and its game state live for the whole
session and the strait survives a level advance without being rebuilt. The
instance's `initialize` registers the actions, defines the cues, loads the sprite
frames, and returns the debug surface. The level's game mode runs the screens and
the rules: its `gameStateClass` is `FloeState`, so the engine builds the state
`specs/state.md` declares when the world opens; its `beginPlay` adds a single
player possessing nothing, whose controller is where the actions are read, and
registers the diagnostic sources through `world.diagnostics`. Leave the camera at
rest, so world units and the stage's logical units coincide. The run's own
figures live in that game state and the strait's bodies are actors in the world,
as `specs/state.md` declares, and nothing the game carries from one tick to the
next lives anywhere else. Implement the game.

**Floe runs on a fixed step, and the step is yours.** The engine ticks the world
against the frame's real elapsed seconds; the simulation advances in whole ticks
of `TICK_DT` (1/120 s), running as many as that elapsed time completes and
carrying the remainder into the next frame. Every rate in `src/constants.ts` is
integrated against that tick rather than against the frame's own delta, and
`state.simTime` accumulates `TICK_DT` on every tick whatever the screen.
`specs/overview.md` states the rule, and the engine's per-world timers express it
directly.

**The sprite art comes from the engine's asset loader**, which resolves every
path under the fixed `assets/` root relative to the page. Await every frame in
the level's load, so a frame is a plain image value by the time anything draws
it. Floe's frames are separate files rather than an atlas, so each frame is its
own image.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as the instance's `initialize` handed it over, and that is
how the game is driven from code, so it is present and exactly as
`specs/instrumentation.md` specifies. Its operations act on the live game at the
call: a pose takes only its own arguments, arranges the running game through the
same systems play uses, and returns nothing, as `engine.debug.setLives(2)`; a
reading returns plain data and changes nothing, as `engine.debug.snapshot()`.
Nothing is published to the page.

`FloeState` and `TAGS` **are contracts**. Keep every field of the game state
under the name, type, and meaning `specs/state.md` gives it, and tag every body
on the strait with its name from `TAGS`, so the strait is findable exactly as the
specification says it is. Fields you add hold data you can rebuild from what
`specs/state.md` declares, and the surface's `reset()` leaves the game
indistinguishable from one freshly started.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over the code you write under `src/`; the
seeded `src/constants.ts` and `src/main.ts` are outside the report. A test stands
the engine up over a canvas from `@napi-rs/canvas`, with a `SurfaceMetrics` and a
scripted clock of the test's own, then advances the game a counted number of
frames with `engine.advance`, so it needs no browser. A test that draws the
critter also needs the seeded sprite art, which the engine's loader reaches for
with browser globals a Node process does not have. The engine's documentation
defines every other piece of that recipe.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage and
  strait geometry and the tile-to-stage map, the five bands and the five bays,
  the hop cooldown, both lane tables and their per-level scaling, the bear's
  speeds and emergence conditions, the run and its scoring, the sprite frame
  counts and widths, the level and tag names, the action names, the bindings, the
  cue names, and the screen copy. Read from it.
- **`assets/`** — the seeded sprite art. `specs/assets.md` is the contract for
  what each folder holds, which frame is drawn for which state, and how each is
  drawn. Draw the game from these frames; do not redraw them, add to them, or
  replace them.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **`.vendor/`** — the vendored engine.

Add dependencies to `package.json` if you genuinely need them, and commit the
`package-lock.json` — the build is installed with `npm ci`. Leave the existing
entries alone.

## Commands

- `npm run dev` — serves the game with hot reload.
- `npm run build` — type-checks, then emits the static site into `dist/`.
- `npm run preview` — serves `dist/` for a final check.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint.
- `npm run format` — Prettier, in check mode.
- `npm test` — Vitest over `src/**/*.test.ts`, with coverage.

## Before you finish

- `npm run build` produces `dist/` with `index.html` at its root and the sprite
  art under `dist/assets/`, and that directory runs as-is on any static host.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
