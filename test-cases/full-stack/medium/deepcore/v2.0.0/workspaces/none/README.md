# Deepcore — starter project

This repository is the starting point for building **Deepcore**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on **no engine**. Nothing here supplies a frame loop, input,
audio, asset loading, a camera, or an overlay, and there is no game code to start
from. What the project supplies is the toolchain, already configured and
installed: TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands
below.

## What you own

**Everything under `src/`.** The directory does not exist yet; create it.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs — the frame loop and the delta time it measures, fitting the
fixed logical stage onto the canvas, keyboard and pointer input, audio, loading the
assets you produce, and the diagnostics overlay — and you write the game itself
on top of it.

The mine is far larger than the stage, so the camera that scrolls the view over
it is yours as well. `specs/world.md` states where it sits each frame and how it
leads the miner's travel.

You also write the `window.__deepcore` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how the
game is driven from code, so it is present and exactly as specified.

Every figure the specification fixes — the stage and grid geometry, the depth
bands, the ore table, the movement and fuel rates, the upgrade ladders, the
rocket costs, the action names and their keys, the cue names, and the screen copy
— is stated in `specs/`, and the value stated there is authoritative.

**You also produce every asset the game plays.** Six asset-generation tools are on
your `PATH` while you build here. `specs/assets.md` is the contract: what to
produce, which tool produces it, the path it lands at, and how it is wired in.
The finished files are committed to this repository and loaded at runtime, and
`npm run build` never invokes the tools.

`@test-cabinet/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a produced
`system.json` into a 2D drawing context. Import it like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without a
browser.

## What you must not edit

- **`index.html`** — the page and the canvas.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **`.tcab/`** — the vendored runtime libraries.

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
  directory runs as-is on any static host, at any base path.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- The assets `specs/assets.md` asks for are produced and committed under
  `assets/`, and the game loads them.
- The `showcase/` directory `specs/showcase.md` asks for is present.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
