# Carom — starter project

This repository is the starting point for building **Carom**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It runs on **no engine**: the runtime a browser
game needs is part of this repository, in `src/host.ts`, which documents every
API the game receives — read it alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

`src/game.ts` exports `game`, a `Game<CaromState>`: three functions and a state
type. `initialize` builds the state once, `update` advances it against the
frame's delta time in seconds, and `render` draws it. All three currently throw
`"not implemented"`. Implement them, and split the work across new modules under
`src/` however you like — physics, rendering, the AI, and so on.

`CaromState` is declared in full in `src/game.ts` and **is a contract**. Keep
every field, under its declared name, type, and meaning. You may add fields, but
only for data you can rebuild from the declared ones: the declared fields are the
whole of the authoritative state, and `window.__carom`'s `reset()` restores
exactly those.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. A test stands a host up over an
`@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, installs a
`ConstantClock`, and steps the game with `host.advance`, so a scenario is
synchronous and needs no browser.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It stands the host up over the
  page's canvas, binds `game` to it, installs the debug API, and runs.
- **`src/host.ts`** — the runtime: the frame loop and its delta time, the
  letterboxed canvas fit, named input actions over keyboard bindings, the audio
  cue bus and its first-gesture unlock, asset resolution, and the diagnostics
  overlay. It is the reference for every API `game` receives.
- **`src/constants.ts`** — every figure the specification fixes: geometry,
  colors, speeds, spin, the match rules, the action names, the cue names. Read
  from it, and never restate a number it already names.
- **`src/debug.ts`** — the `window.__carom` debugging and automation API from
  `specs/instrumentation.md`, supplied already written. It poses and reads
  `CaromState`; your `update` is what runs from there.
- **`index.html`** — the page and the canvas the host fits the field into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`.

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
