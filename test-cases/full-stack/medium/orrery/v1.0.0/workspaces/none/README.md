# Orrery — starter project

This repository is the starting point for building **Orrery**, the game the
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
fixed logical stage onto the canvas, pointer and keyboard input, audio, and the
diagnostics overlay — and you write the game itself on top of it.

Orrery is operated with the pointer, so the pointer path is part of what you
build: taking the cursor off the page, mapping its position into the game's
logical units through the same fit you use to draw, and delivering its movement
and its press and release edges to the game. `specs/controls.md` and
`specs/editor.md` state what Orrery does with them.

You also write the `window.__orrery` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how
the game is driven from code, so it is present and exactly as specified.

Every figure the specification fixes — the stage, field, and editor geometry,
the mote and part rosters, the costs, the instruction set, the speeds, the
action bindings, the cue names, the screen copy — is stated in `specs/`. Name
them once in your own module and read from it, rather than restating a number
at each use.

**You also produce every asset the game shows and plays.** Asset-generation
tools are on your `PATH` while you build here. `specs/assets.md` is the
contract: what to produce, which tool produces it, the path it lands at, and the
bar it is held to. The finished files are committed to this repository and
loaded at runtime, and `npm run build` never invokes the tools.

`@test-cabinet/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a produced
`system.json` into a 2D drawing context. Import it like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without
a browser.

## What you must not edit

- **`index.html`** — the page and the canvas.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`,
  `.prettierignore`, and `.gitignore`.
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
  directory runs as-is on any static host.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all
  pass. The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
