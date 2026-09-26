# Gantry — starter project

This repository is the starting point for building **Gantry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on **no engine**. Nothing here supplies a frame loop, input,
audio, asset loading, or an overlay, and there is no game code to start from.
What the project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below, plus
`three` for the 3D scene.

## What you own

**Everything under `src/`, and everything under `assets/`.** Neither directory
exists yet; create them.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs — the frame loop and the delta time it measures, fitting
the fixed logical stage onto the canvas, pointer and keyboard input, audio,
loading the produced files, and the diagnostics overlay — and you write the
game itself on top of it.

The yard is built and orbited with the pointer, so the pointer path is part of
what you build: taking the cursor off the page and delivering its position in
the game's logical units, with its press and release edges, to the game.
`specs/controls.md` states what Gantry does with them.

You also write the `window.__gantry` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how
the game is driven from code, so it is present and exactly as specified.

**You produce the game's models and audio during this build.**
`specs/assets.md` is the contract: which of the four tools on this container's
`PATH` produces each model and sound, and the bar it meets. Commit the produced
files under `assets/` and load them at run time. The finished repository builds
and runs with those tools absent, so nothing is generated at build time.
`@clockwyrks/voxel-runtime` is already a dependency, vendored under `.vendor/`,
and it is what decodes a produced `.glb` into a mesh and builds the geometry the
scene draws.

Every figure the specification fixes — the lattice and materials, the axis
rates, the tolerances, the six sites, the camera, the action names, the cue
names, and the screen copy — is stated in `specs/`, and the value stated there
is authoritative.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, in Node, with coverage over `src/`, and with no browser
and no DOM, so nothing that needs a `webgl2` context runs there.
`@napi-rs/canvas` is installed for a test that wants a real 2D context to draw
through.

## What you must not edit

- **`index.html`** — the page and the canvas.
- **`.vendor/`** — the vendored packages `package.json` resolves the voxel
  runtime from.
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
- The produced files under `assets/` are committed alongside your source, and
  the build loads them without running any of the asset tools.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
