# Orrery — starter project

This repository is the starting point for building **Orrery**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine,
which is installed as an ordinary dependency and documents itself under
`engine/` — read that alongside the specs. What is missing is the game, and the
art and sound it plays.

## What you own

**`src/game.ts`, and any new files you add beside it.**

Start by declaring and exporting `OrreryState`, exactly as `specs/state.md`
fixes it — a class extending the engine's `GameState` — and `OrreryDebugApi`,
the debug and automation surface `specs/instrumentation.md` specifies. The stub
in `src/game.ts` is written against both names, so the project does not compile
until they exist — a fresh workspace failing `npm run typecheck` is the starting
point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<OrreryDebugApi>`: the game
instance class, a level registry holding the single level the game runs in —
keyed by the `LEVEL_NAME` `src/constants.ts` fixes — and `startLevel` naming it.
The engine opens that one level and the game never opens another, so the world
and its game state live for the whole session and every screen is a value of the
state's `screen` field. The instance's `initialize` registers the actions,
defines the cues, loads the produced assets, and returns the debug surface. The
level's game mode runs the screens and the rules, and it adds a single player in
its `beginPlay`, whose controller is where the actions and the pointer are read.
The mode's `gameStateClass` is `OrreryState`, and the framework's states are
live objects, so a tick writes the fields it advances in place. The instance
currently throws `"not implemented"`. Implement it.

Each actor carries its tag from `TAGS`, and the game leaves the camera at rest,
so world units and the stage's logical units coincide.

**The pointer comes from the engine.** The machine is built with the pointer,
and the player controller reads it from its input reader already in logical
stage units, as the frame's ordered samples carrying the press and release edges
— read the engine's input documentation for the API. `specs/controls.md` and
`specs/editor.md` state what Orrery does with them.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as the instance's `initialize` handed it over, and that
is how the game is driven from code, so it is present and exactly as
`specs/instrumentation.md` specifies. Its operations act on the live world at
the moment they are called: a pose takes only the parameters the specification
names for it and returns nothing, as `engine.debug.loadChallenge(challenge)`,
and a reading returns plain data, as `engine.debug.snapshot()`. Nothing is
published to the page.

`OrreryState` **is a contract**. Keep every field, under the name, type, and
meaning `specs/state.md` gives it. You may add fields, but only for data you
can rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

**You also produce every asset the game shows and plays.** Asset-generation
tools are on your `PATH` while you build here. `specs/assets.md` is the
contract: what to produce, which tool produces it, the path it lands at, and the
bar it is held to. The finished files are committed to this repository and
loaded through the engine's asset loader at runtime, and `npm run build` never
invokes the tools.

`@test-cabinet/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a
produced `system.json` into a 2D drawing context — the one a component that
draws directly is handed, since the engine's declarative pipeline does not draw
particles. Import it like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. A test stands the engine up
over a canvas from `@napi-rs/canvas`, with a `SurfaceMetrics` and a scripted
clock of the test's own, then advances the game a counted number of frames with
`engine.advance`, so it needs no browser. The engine's documentation defines
every piece of that recipe.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage,
  field, and editor geometry, the mote and part rosters, the costs, the
  instruction set, the speeds, the action names and bindings, the cue names,
  the produced-asset paths, the level name and actor tags, and the screen copy.
  Read from it.
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
  directory runs as-is on any static host, at its root and under a sub-path.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all
  pass. The same four commands are run over the repository you leave behind.
- The assets `specs/assets.md` asks for are produced and committed under
  `assets/`, and the game loads them.
- The `showcase/` directory `specs/showcase.md` asks for is present.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
