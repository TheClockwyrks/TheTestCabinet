# Carom — starter project

This repository is the starting point for building **Carom**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

Start by declaring and exporting `CaromState`, exactly as `specs/state.md` fixes
it, and `CaromDebugApi`, the debug and automation surface `specs/instrumentation.md`
specifies. The stub in `src/game.ts` is written against both names, so the
project does not compile until they exist — a fresh workspace failing
`npm run typecheck` is the starting point, not a fault in the project.

`src/game.ts` then exports `game`, a `Game<CaromState, CaromDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<CaromState>`, from `ts-essentials`) and
returns the next state, advanced against the frame's delta time in seconds; and
`render` is handed that next state, read-only again, and draws it. The engine
holds the state by value and replaces it with whatever `update` returns, so a
frame builds the next state from the current one rather than writing into it,
and the type is what guarantees that rendering changes nothing. All three
currently throw `"not implemented"`. Implement them.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: every one takes the current state first, then the
arguments its heading names. A pose returns the next state, applied through
`engine.apply((s) => debug.setScreen(s, "countdown"))`; a reading returns what
it read, as `debug.snapshot(engine.state)`. Nothing is published to the page.

`CaromState` **is a contract**. Keep every field, under the name, type, and
meaning `specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's documentation
carries a complete worked example of testing a game this way.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: geometry,
  speeds, spin, the match rules, the action names, the cue names. Read from it.
- **`index.html`** — the page and the canvas the engine fits the field into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **The vendored engine directory** that `package.json` resolves the engine
  dependency from.

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
