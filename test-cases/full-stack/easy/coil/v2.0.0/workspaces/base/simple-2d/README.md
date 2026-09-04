# Coil — starter project

This repository is the starting point for building **Coil**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game, and the art and sound it
plays.

## What you own

**`src/game.ts`, and any new files you add beside it.**

Start by declaring and exporting `CoilState`, the game's whole state, and
`CoilDebugApi`, the debug and automation surface `specs/instrumentation.md`
specifies. The stub in `src/game.ts` is written against both names, so the
project does not compile until they exist — a fresh workspace failing
`npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `Game<CoilState, CoilDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<CoilState>`, from `ts-essentials`) and
returns the next state, advanced against the frame's delta time in seconds; and
`render` is handed that next state, read-only again, and draws it. The engine
holds the state by value and replaces it with whatever `update` returns, so a
frame builds the next state from the current one rather than writing into it,
and the type is what guarantees that rendering changes nothing. All three
currently throw `"not implemented"`. Implement them.

**The fixed tick is yours.** The engine hands `update` the real elapsed seconds
of each frame and imposes no timestep of its own. Coil advances in whole ticks
of `TICK_SECONDS`, so `update` accumulates those seconds and resolves each whole
tick in the order `specs/movement.md` fixes, carrying the remainder. Drawing
advances nothing.

**The assets under `assets/`.** That directory does not exist yet. Coil ships no
art and no sound: the snake's sprite set and the game's cues and music are
produced during this build with the generation binaries on the `PATH`, committed
here, and bundled. `specs/assets.md` states what to produce, which binary makes
each file, and the bar each is held to; `src/constants.ts` names the path each
lands at. Load them through the engine's asset loader and bind the cues to its
cue bus.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and a
caller applies it through `engine.apply((s) => debug.setScore(s, 120))`; a
reading takes the state and returns what it read, as `debug.snapshot(engine.state)`.
Nothing is published to the page.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, with coverage over `src/`. The engine's documentation carries a
complete worked example of testing a game this way.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage and
  board geometry, the starting chain, the tick and the turn buffer, the combo and
  its window, the mode's copy, the screen copy, the action names and their
  bindings, the cue names, and the paths the produced files land at. Read from
  it.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
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
  directory runs as-is on any static host, at its root and under a sub-path.
- The produced files under `assets/` are committed, and the build bundles them
  rather than regenerating them.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
