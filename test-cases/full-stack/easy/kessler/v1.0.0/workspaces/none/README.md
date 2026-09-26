# Kessler — starter project

This repository is the starting point for building **Kessler**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on **no engine**. Nothing here supplies a frame loop, input,
audio, asset loading, or an overlay, and there is no game code to start from.
What the project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below.

## What you own

**Everything under `src/`.** The directory does not exist yet; create it.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs — the frame loop and the delta time it measures, fitting the
fixed 1000x1000 logical stage onto the canvas, keyboard and pointer input,
image loading, audio with looping beds, and the diagnostics overlay — and you
write the game itself on top of it.

Kessler advances on a fixed tick fed by elapsed time, so the loop you write is
what the whole simulation rests on: `specs/overview.md` states the tick,
`specs/field.md` the order it resolves in, and drawing advances nothing.

You also write the `window.__kessler` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how the
game is driven from code, so it is present and exactly as specified.

**You also produce every asset the game plays.** Asset-generation tools are on
your `PATH` while you build here. `specs/assets.md` is the contract: what to
produce, which tool produces it, the path it lands at, and how it is wired in.
The finished files are committed to this repository and loaded at runtime, and
`npm run build` never invokes the tools.

`@clockwyrks/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a produced
`system.json` into a 2D drawing context. Import it like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without a
browser.

## What stays as it is

`specs/overview.md` lists the files this project supplies and keeps, and states
the one change `package.json` takes.

## Commands

- `npm run dev` — serves the game with hot reload.
- `npm run build` — type-checks, then emits the static site into `dist/`.
- `npm run preview` — serves `dist/` for a final check.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint.
- `npm run format` — Prettier, in check mode.
- `npm test` — Vitest over `src/**/*.test.ts`, with coverage.

## This file

This starter README is replaced by the `README.md` `specs/overview.md` asks the
finished build to ship: what the game is, how to install it, how to run it in
development, how to produce the production build, and the controls.
