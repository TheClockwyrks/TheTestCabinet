# Arc Foundry — starter project

This repository is the starting point for building **Arc Foundry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine,
which is installed as an ordinary dependency and documents itself under
`engine/` — read that alongside the specs. What is missing is the game, and the
art, effects, and audio it plays.

## What you own

**`src/game.ts`, any new files you add beside it, and everything under
`assets/`.**

Start by declaring and exporting `FoundryState`, the class the whole of the
game's authoritative state is held in — a class extending the engine's
`GameState` — and `FoundryDebugApi`, the debug and automation surface
`specs/instrumentation.md` specifies. The stub in `src/game.ts` is written
against both names, so the project does not compile until they exist — a fresh
workspace failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<FoundryDebugApi>`: the game
instance class, a level registry holding the single level the game runs in, and
`startLevel` naming it. The engine opens that level once and the game never
opens another — every screen is a value of the state's `screen` field, so the
world and its game state live for the whole session. The instance's `initialize`
registers the actions, defines the cues, loads the produced assets, and returns
the debug surface. The level's game mode runs the screens and the rules: its
`gameStateClass` is `FoundryState`, so the engine builds that state when the
world opens; its `beginPlay` adds a single player possessing nothing, whose
controller is where the actions and the pointer are read, and registers the
diagnostic sources through `world.diagnostics`; and its `tick` advances the
simulation clock and mirrors the engine's mute bit into the state. Leave the
camera at rest, so world units and the stage's logical units coincide. The state
is the whole of the authoritative game — the actors, components, and controllers
you write draw it and drive it, holding nothing authoritative of their own.
Implement the game.

**The pointer comes from the engine.** The yard is built by pressing on the
stage, and the player controller reads it from its input reader already in
logical stage units, as the frame's ordered samples carrying the press and
release edges — read the engine's input documentation for the API.
`specs/controls.md` states what Arc Foundry does with them.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as the instance's `initialize` handed it over, and that
is how the game is driven from code, so it is present and exactly as
`specs/instrumentation.md` specifies. Its operations act on the live game at
the call: a pose takes only its own arguments, arranges the running game
through the same systems play uses, and returns nothing, as
`engine.debug.setCharge(500)`; a reading returns plain data and changes
nothing, as `engine.debug.snapshot()`. Nothing is published to the page.

**You produce the game's art, effects, and audio during this build.**
`specs/assets.md` is the contract: which of the six tools on this container's
`PATH` produces each sprite, animation cycle, particle system, and sound, the
exact path it lands at under `assets/`, and the bar it meets. Commit the produced
files and load them through the engine's asset loader, which resolves every path
under that root. The finished repository builds and runs with those tools absent,
so nothing is generated at build time. `@test-cabinet/particle-runtime` is
already a dependency, vendored under `.tcab/`; the declarative pipeline draws no
particles, so a produced system is played through its canvas binding from a draw
component handed the raw context.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. A test stands the engine up
over a canvas from `@napi-rs/canvas`, with a `SurfaceMetrics` and a scripted
clock of the test's own, then advances the game a counted number of frames with
`engine.advance`, so it needs no browser. The engine's documentation defines
every piece of that recipe.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage and
  grid geometry, the three maps, the Load roster, the component and combination
  tables, the refinement odds, the difficulties, the action names, the cue names,
  and the screen copy. Read from it.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  `.gitignore`.
- **`.tcab/`** — the vendored engine and the produced-effect runtime.
- **`engine/`** — the engine's own documentation.

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

- `npm run build` produces `dist/` with `index.html` at its root, and that
  directory runs as-is on any static host, at its root or under a sub-path.
- The produced files under `assets/` are committed, and the build loads them
  without running any of the asset tools.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
