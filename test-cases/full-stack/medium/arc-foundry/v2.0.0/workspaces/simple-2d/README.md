# Arc Foundry — starter project

This repository is the starting point for building **Arc Foundry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game, and the art, effects, and
audio it plays.

## What you own

**`src/game.ts`, any new files you add beside it, and everything under
`assets/`.**

`src/game.ts` declares and exports `FoundryState`, the type the whole of the
game's state is held in, and `FoundryDebugApi`, the debug and automation surface
`specs/instrumentation.md` specifies. The seeded stub is written against both
names, so the project does not compile until they exist — a fresh workspace
failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `Game<FoundryState, FoundryDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<FoundryState>`, from `ts-essentials`)
and returns the next state, advanced against the frame's delta time in seconds;
and `render` is handed that next state, read-only again, and draws it. The engine
holds the state by value and replaces it with whatever `update` returns, so a
frame builds the next state from the current one rather than writing into it, and
the type is what guarantees that rendering changes nothing. All three currently
throw `"not implemented"`. Implement them.

**The pointer and the touch contact come from the engine.** The yard is built by
pressing on the stage and the menus answer to a finger, and the engine hands the
game each position already in logical stage units along with its press and
release edges — read the engine's input documentation for the API.
`specs/controls.md` states what Arc Foundry does with them.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and a
caller applies it through `engine.apply((s) => debug.setCharge(s, 500))`; a
reading takes the state and returns what it read, as `debug.snapshot(engine.state)`.
Nothing is published to the page.

**You produce the game's art, effects, and audio during this build.**
`specs/assets.md` is the contract: which of the six tools on this container's
`PATH` produces each sprite, animation cycle, particle system, and sound, the
exact path it lands at under `assets/`, and the bar it meets. Commit the produced
files and load them through the engine's asset loader, which resolves every path
under that root. The finished repository builds and runs with those tools absent,
so nothing is generated at build time. `@test-cabinet/particle-runtime` is
already a dependency, vendored under `.tcab/`, and it is what plays a produced
particle system.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's documentation
carries a complete worked example of testing a game this way.

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
