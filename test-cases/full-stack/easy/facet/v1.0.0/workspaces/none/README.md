# Facet — starter project

This repository is the starting point for building Facet, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on no engine. Nothing here supplies a frame loop, input, audio,
asset loading, or an overlay, and there is no game code to start from. What the
project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below,
plus `@test-cabinet/particle-runtime` for simulating and drawing the particle
systems you produce.

## What you own

Everything under `src/`. The directory does not exist yet; create it.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs and the game itself on top of it:

- the frame loop and the delta time it measures;
- fitting the fixed logical stage onto the canvas;
- keyboard and pointer input;
- audio, with cues and a bed that loops;
- loading the sprites, sheets, particle systems, and sounds you produce;
- the diagnostics overlay;
- the board and its gems, the swap and chain rules, strain, scoring and levels,
  and the screens.

The board is played with the pointer alone and every screen is worked with it,
so the pointer path is part of what you build: taking a mouse, a pen, and a
finger off the page and delivering the position in the game's logical units,
with its movement, its press and release edges, and the device that drove it, to
the game. It also takes the browser's own gestures on the canvas, so a drag on a
touchscreen reaches the game whole rather than being taken for a scroll part way
through. `specs/controls.md` states what Facet does with them.

You also write the `window.__facet` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how
the game is driven from code, so it is present and exactly as specified.

You also produce the game's sprites, effects, and audio with the asset tools on
this machine's `PATH` and commit the produced files under `public/assets/`;
`specs/assets.md` is the contract. The tools are absent when the build is
installed and rebuilt elsewhere, so the build bundles the committed files and
invokes no tool.

Every figure the specification fixes is stated in `specs/`: the stage and board
geometry, the cell pitch and the targeting radius, the gem kinds, cuts, and
strain, the swap and resolution rules, the chain cadence, the scoring and level
figures, the action names, the cue names, and the screen copy. Name each one
once in your own module and read from it, rather than restating a number at each
use.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without
a browser.

## What stays as it is

- `index.html`, the page and the canvas.
- `.tcab/`, holding the vendored package that `package.json` resolves
  `@test-cabinet/particle-runtime` from.
- The toolchain: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`,
  `.prettierignore`, and `.gitignore`.

Add dependencies to `package.json` if you genuinely need them, and commit the
`package-lock.json`; the build is installed with `npm ci`. Leave the existing
entries and scripts alone.

## Commands

- `npm run dev` serves the game with hot reload.
- `npm run build` type-checks, then emits the static site into `dist/`.
- `npm run preview` serves `dist/` for a final check.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run lint` runs ESLint.
- `npm run format` runs Prettier in check mode.
- `npm test` runs Vitest over `src/**/*.test.ts`, with coverage.

## Before you finish

- `npm run build` produces `dist/` with `index.html` at its root, and that
  directory runs as-is on any static host, from a sub-path included.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all
  pass. The same four commands are run over the repository you leave behind.
- The produced files under `public/assets/` are committed alongside your
  source.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
