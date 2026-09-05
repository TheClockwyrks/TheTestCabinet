# Cascade — starter project

This repository is the starting point for building **Cascade**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine, which
is installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

The module does not exist yet. `src/main.ts` imports `game` and `BACKGROUND` from
it, so the project does not compile until you create it — a fresh workspace
failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` exports `game`, the `GameDefinition` the engine drives: the level
registry, keyed by exactly the names `LEVELS` holds, with the table level opened
first, and your own `GameInstance` subclass. Behind that definition you write the
whole game — the game mode that holds the rules and the four screens, the actors
that draw the table, the cascade and the HUD, each carrying its tag from `TAGS` so
`world.byTag` finds it under the names the specification uses, the components that
draw them, and the controller that reads the pointer. The instance's `initialize`
defines the ten `CUES`, registers the diagnostic sources
`specs/instrumentation.md` lists, and returns the debug surface.

Cascade runs in **one** world for the whole session: every screen is a value of
the state's `screen` field rather than a level of its own, which is why `LEVELS`
holds a single entry.

`src/game.ts` also exports `BACKGROUND`, a CSS color string: the table background
`src/main.ts` hands the engine as the color the canvas is cleared to each frame,
so the letterbox bars around the table match the table itself.

The debug surface is a required deliverable. The engine hands back from
`engine.debug` exactly what `initialize` returned, and that is how the game is
driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Each of its operations is a method acting on the running game: a pose
takes only the arguments its heading names, returns nothing, and arranges the live
world through the same systems play uses; a reading takes none and returns plain
data read off the world at the call, as `engine.debug.snapshot()`. `move` and
`autoMove` are the exception: each applies the game's own rules and returns the
boolean those rules decided. Nothing is published to the page.

`LEVELS` and `TAGS` **are contracts**, like every other name in
`src/constants.ts`. The level is registered under its name in `LEVELS`, and every
actor carries its tag from `TAGS`.

Cascade draws every card, the table, the HUD and every screen in code. There are
no image assets, and none are seeded.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, with coverage over the code you write under `src/`. A test
stands the engine up over its own canvas, scripted clock, and surface, steps it
with `engine.advance`, and reads the result back from the world and the debug
surface. The engine's documentation carries a complete worked example of testing
a game this way.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the page's
  canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the table's
  geometry, the key bindings, the deck, this build's deal mode, the
  cascade's figures, the screen copy, the cue names, the level name, the actor
  tags. Read from it.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **`.vendor/`** — the vendored engine.
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
  directory runs as-is on any static host.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
