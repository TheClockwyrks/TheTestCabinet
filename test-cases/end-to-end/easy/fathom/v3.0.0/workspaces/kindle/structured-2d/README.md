# Fathom — starter project

This repository is the starting point for building **Fathom**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine,
which is installed as an ordinary dependency and documents itself under
`engine/` — read that alongside the specs. What is missing is the game.

In Fathom the forager carries an outer vision circle, and the maze is drawn only
inside it: explored ground beyond the circle is blacked out while staying
remembered underneath. `specs/sensing.md` gives the circle's radius, what is
drawn inside it, and what shows over the blackout, and the state contract in
`specs/state.md` already carries `windowRadius` beside the light radius.

## What you own

**`src/game.ts`, and any new files you add beside it.**

Start by declaring and exporting `FathomState`, exactly as `specs/state.md`
fixes it — a class extending the engine's `GameState` — and `FathomDebugApi`,
the debug and automation surface `specs/instrumentation.md` specifies. The stub
in `src/game.ts` is written against both names, so the project does not compile
until they exist — a fresh workspace failing `npm run typecheck` is the starting
point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<FathomDebugApi>`: the game
instance class, a level registry holding the single level the game runs in, and
`startLevel` naming it. The engine opens that level once and the game never
opens another — every screen is a value of the state's `screen` field, so the
world and its game state live for the whole session and a dive is not a level
transition. The instance's `initialize` registers the actions, defines the
cues, loads the art, and returns the debug surface. The level's game mode runs
the screens and the rules: its `gameStateClass` is `FathomState`, so the engine
builds the state `specs/state.md` declares when the world opens; its `beginPlay`
adds a single player possessing nothing, whose controller is where the actions
are read, and registers the diagnostic sources through `world.diagnostics`; and
its `tick` accumulates `state.simTime` and mirrors the engine's mute bit into
`state.muted`. Leave the camera at rest, so world units and the stage's logical
units coincide. The state is the whole of the authoritative game — the actors,
components, and controllers you write draw it and drive it, holding nothing
authoritative of their own. Implement the game.

**The art is seeded under `assets/`:** seven sprite sheets covering the forager,
the three predators, the bonus drifter, the flare bloom, and the maze tiles.
The engine's asset loader reads them, resolving every path under the `assets/`
root — read the engine's asset documentation for the API. `specs/assets.md`
states what each sheet holds, how the game renders it, and what Fathom draws in
code instead.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as the instance's `initialize` handed it over, and that
is how the game is driven from code, so it is present and exactly as
`specs/instrumentation.md` specifies. Its operations act on the live game at
the call: a pose takes only its own arguments, arranges the running game
through the same systems play uses, and returns nothing, as
`engine.debug.setMaze(rows)`; a reading returns plain data and changes nothing,
as `engine.debug.snapshot()`. Nothing is published to the page.

`FathomState` **is a contract**. Keep every field, under the name, type, and
meaning `specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

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
  tile-grid geometry, the fixed timestep, the speeds, the maze proportions,
  brightness and the light, the sonar and the ink, the three predators, the
  scoring, the action names and bindings, and the cue names. Read from it.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **`assets/`** — the art seeded with the project.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`.
- **`.tcab/`** — the vendored engine.

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
  directory runs as-is on any static host.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
