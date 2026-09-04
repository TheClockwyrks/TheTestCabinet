# Deepcore — starter project

This repository is the starting point for building **Deepcore**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine, which
is installed as an ordinary dependency and documents itself under `engine/` —
read that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

`src/game.ts` declares and exports `DeepcoreState` — a class extending the
engine's `GameState`, carrying the whole authoritative state the specification's
rules require of the game — and `DeepcoreDebugApi`, the debug and automation
surface `specs/instrumentation.md` specifies. The seeded stub is written against
both names, so the project does not compile until they exist — a fresh workspace
failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<DeepcoreDebugApi>`: the game
instance class, a level registry holding the single level the game runs in, and
`startLevel` naming it. The engine opens that one level and the game never opens
another, so the world and its game state live for the whole session and every
screen is a value of the state's `screen` field. The instance's `initialize`
registers the actions, defines the cues, loads the produced assets, and returns
the debug surface. The level's game mode runs the screens and the rules, and it
adds a single player in its `beginPlay`, whose controller is where the actions
are read. The mode's `gameStateClass` is `DeepcoreState`, and the framework's
states are live objects, so a tick writes the fields it advances in place. The
instance currently throws `"not implemented"`. Implement it.

**The camera is the engine's.** The mine is far wider and far deeper than the
logical field, and the engine's camera is what projects one into the other. The
game positions it each frame and otherwise leaves it at a zoom of `1` and no
rotation; `specs/world.md` states where it sits.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game is
driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Its operations act on the live world at the moment they are called: a
pose or a control takes only the parameters the specification names for it and
returns nothing, and a reading returns plain data. Nothing is published to the
page.

**You also produce every asset the game plays.** Six asset-generation tools are on
your `PATH` while you build here. `specs/assets.md` is the contract: what to
produce, which tool produces it, the path it lands at, and how it is wired in.
The finished files are committed to this repository and loaded through the
engine's asset loader at runtime, and `npm run build` never invokes the tools.

`@test-cabinet/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a produced
`system.json` into a 2D drawing context — the one a component that draws directly
is handed, since the engine's declarative pipeline does not draw particles.
Import it like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's documentation
carries a complete worked example of testing a game this way.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage and
  grid geometry, the depth bands and what generation places, the ore table, the
  movement, drill, fuel and hull rates, the hazard figures, the seven upgrade
  ladders, the rocket components, the field supplies, the action names and their
  keys, the cue names, and the screen copy. Read from it.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **`.tcab/`** — the vendored engine and runtime libraries.
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
  directory runs as-is on any static host, at any base path.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- The assets `specs/assets.md` asks for are produced and committed under
  `assets/`, and the game loads them.
- The `showcase/` directory `specs/showcase.md` asks for is present.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
