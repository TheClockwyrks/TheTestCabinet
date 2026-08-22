# Carom — starter project

This repository is the starting point for building **Carom**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

In this variant the two mid-field obstacles are **live**: they sway and rotate,
and the ball bounces off their tilted faces. `specs/playfield.md` gives the pose
formulas and the oriented collision, and `specs/instrumentation.md` covers the
`setObstacleClock` operation and the obstacle poses a snapshot reports. Both are
already reflected in the state contract and the debug API below — what is missing
is, as ever, the game.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

Start by declaring and exporting `CaromState`, exactly as `specs/state.md` fixes
it. `src/debug.ts` poses and reads that type, so the project does not compile
until it exists — a fresh workspace failing `npm run typecheck` is the starting
point, not a broken seed.

`src/game.ts` then exports `game`, a `Game<CaromState, CaromDebugApi>`: three
functions over that state. `initialize` builds the state once, `update` advances
it against the frame's delta time in seconds, and `render` draws it. All three
currently throw `"not implemented"`. Implement them, and split the work across
new modules under `src/` however you like — physics, rendering, the AI, and so on.

`initialize` must also hand the debug surface to the engine before it returns:

```ts
api.debug.expose(createDebugApi(state));
```

That call is how a check reaches this build. Nothing is published to the page.

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
  colors, speeds, spin, the match rules, the action names, the cue names. Read
  from it, and never restate a number it already names.
- **`src/debug.ts`** — the debugging and automation surface from
  `specs/instrumentation.md`, supplied already written. It poses and reads
  `CaromState`; your `update` is what runs from there. Build it with
  `createDebugApi(state)` and expose it from `initialize`.
- **`index.html`** — the page and the canvas the engine fits the field into.
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
