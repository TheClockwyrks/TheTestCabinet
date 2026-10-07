# Shatter — starter project

This repository is the starting point for building **Shatter**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up: Vite builds it, Vitest tests it, ESLint lints
it, Prettier formats it, and its dependencies are installed. What is missing is
everything else.

## What you own

**All of `src/`. There is none yet.**

`index.html` loads `/src/main.ts`, so that module is where the build starts —
create it. This project supplies no runtime, so the layer beneath the game is
yours as well as the game: the frame loop and the delta it measures, the
fixed-step accumulator `specs/simulation.md` fixes the rate of, fitting the
1280x720 logical field into the canvas (the uniform scale, the centred
letterbox, the device pixel ratio, and the resync when any of them changes),
reading the keyboard and the pointer, synthesizing the audio, drawing the debug
overlay, and installing the `window.__shatter` surface
`specs/instrumentation.md` specifies.

`specs/` fixes what Shatter needs from that layer and nothing else about it: how
it is structured under `src/` is your call.

Every figure the game is built on is in `specs/`, named there and nowhere else in
this project. Nothing is seeded for you to read them off.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. `@napi-rs/canvas` is installed
for a test that needs a real 2D context to draw through.

## What you must not edit

- **`index.html`** — the page and the canvas the field is fitted into.
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
