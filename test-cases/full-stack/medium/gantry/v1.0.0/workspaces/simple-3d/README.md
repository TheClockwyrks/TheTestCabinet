# Gantry — starter project

This repository is the starting point for building **Gantry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on the **Simple 3D** engine, already a dependency of the
project and vendored under `.tcab/`. The engine documents itself in `engine/`
at the root of this repository; read all of it before you start. It owns the
frame loop and the delta time it hands the game, the input actions, the
pointer, audio, and the debug overlay, and it holds the game's state by value.
`three` and `@test-cabinet/voxel-runtime` are installed for the 3D scene and
the models you produce.

## What you own

**`src/game.ts`**, and any new modules you add beside it under `src/`. As
seeded, its `initialize`, `update`, and `render` throw `"not implemented"`, and
the project does not type-check until the `GantryState` and `GantryDebugApi`
declarations the specification asks for exist — that first failure is the
starting point, not a broken seed.

You also produce the game's models and audio with the asset tools on this
machine's `PATH` and commit the produced files under `assets/`;
`specs/assets.md` is the contract. The tools are absent when the build is
installed and rebuilt elsewhere, so the build bundles the committed files and
invokes no tool.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, in Node, with coverage over `src/`; a test stands the
engine up over its own canvas and clock, so it needs no browser and no WebGL.

## What you must not edit

- **`src/main.ts`** — the entry point; it already binds `game` to the engine.
- **`src/constants.ts`** — every figure the specification fixes, named once.
  Import from it everywhere.
- **`index.html`** — the page and the canvas.
- **`.tcab/`** and **`engine/`** — the vendored engine and its documentation.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`,
  `.prettierignore`, and `.gitignore`.

Add dependencies to `package.json` if you genuinely need them, and commit the
`package-lock.json` — the build is installed with `npm ci`. Leave the existing
entries and scripts alone.

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
  directory runs as-is on any static host, from a sub-path included.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all
  pass. The same four commands are run over the repository you leave behind.
- The produced files under `assets/` are committed alongside your source.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
