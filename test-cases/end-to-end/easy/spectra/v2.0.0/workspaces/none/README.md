# Spectra — starter project

This repository is the starting point for building **Spectra**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on **no engine**. Nothing here supplies a frame loop, input,
audio, asset loading, or an overlay, and there is no game code to start from.
What the project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below; the
sprite art and the particle system under `assets/`; and the particle runtime that
plays the particle system.

## What you own

**Everything under `src/`.** The directory does not exist yet; create it.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs — the frame loop and the delta time it measures, fitting the
fixed logical stage onto the canvas, keyboard input, audio, and the diagnostics
overlay — and you write the game itself on top of it.

You also write the `window.__spectra` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how the
game is driven from code, so it is present and exactly as specified.

Every figure the specification fixes — the stage and field geometry, the sub-step
ceiling, the ship's lane and its cannon, the formation slot grid and its sway, the
three drones' rhythms, the resonance meter and the discharge, the stage ladder and
its scaling formulas, every score figure, the screen copy — is stated in `specs/`,
and the value stated there is authoritative.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without a
browser.

## What you must not edit

- **`assets/`** — the seeded sprite art and the seeded drone-burst system.
  `specs/assets.md` is the contract for what each file depicts, the canvas it is
  drawn on, and how the other band-state is derived from it. Draw the game from
  these files; do not redraw them, add to them, or replace them. Load them
  page-relative, so the produced site runs at any base path.
- **`index.html`** — the page and the canvas.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`. `vite.config.ts` is what serves `assets/` in development and
  copies the same tree into `dist/` when the site is built.
- **`.tcab/`** — the vendored particle runtime.

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

- `npm run build` produces `dist/` with `index.html` at its root and the seeded
  art under `dist/assets/`, and that directory runs as-is on any static host.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
