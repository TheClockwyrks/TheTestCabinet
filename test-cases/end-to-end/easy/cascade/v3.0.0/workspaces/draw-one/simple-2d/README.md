# Cascade — starter project

This repository is the starting point for building **Cascade**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

Start by declaring and exporting `CascadeState`, exactly as `specs/state.md` fixes
it, and `CascadeDebugApi`, the debug and automation surface
`specs/instrumentation.md` specifies. The stub in `src/game.ts` is written against
both names, so the project does not compile until they exist — a fresh workspace
failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `Game<CascadeState, CascadeDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<CascadeState>`, from `ts-essentials`) and
returns the next state, advanced against the frame's delta time in seconds; and
`render` is handed that next state, read-only again, and draws it. The engine
holds the state by value and replaces it with whatever `update` returns, so a
frame builds the next state from the current one rather than writing into it, and
the type is what guarantees that rendering changes nothing. All three currently
throw `"not implemented"`. Implement them.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game is
driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and a
caller applies it through `engine.apply((s) => debug.addCard(s, ...))`; a reading
takes the state and returns what it read, as `debug.snapshot(engine.state)`.
`move` and `autoMove` are neither, because each applies the game's own rules and
then reports what those rules decided: each returns the pair `[nextState,
boolean]`. Nothing is published to the page.

`CascadeState` **is a contract**. Keep every field, under the name, type, and
meaning `specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

Cascade draws every card, the table, the HUD and every screen in code. There are
no image assets, and none are seeded.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, with coverage over the code you write under `src/`.
`@napi-rs/canvas` is installed to supply the 2D context, so a test stands the
engine up over a canvas and a clock of its own, steps it with `engine.advance`,
and reads the result back through the debug surface. The engine's documentation
carries a worked example of driving it that way.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the page's
  canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the table's
  geometry, the key bindings, the deck, this build's deal mode, the
  cascade's figures, the screen copy, and the cue names. Read from it.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **`.tcab/`** — the vendored engine.
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
