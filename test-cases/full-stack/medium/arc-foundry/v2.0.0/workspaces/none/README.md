# Arc Foundry — starter project

This repository is the starting point for building **Arc Foundry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on **no engine**. Nothing here supplies a frame loop, input,
audio, asset loading, or an overlay, and there is no game code to start from.
What the project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below.

## What you own

**Everything under `src/`, and everything under `assets/`.** Neither directory
exists yet; create them.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs — the frame loop and the delta time it measures, fitting the
fixed logical stage onto the canvas, pointer and keyboard input, audio, loading
the produced files, and the diagnostics overlay — and you write the game itself
on top of it.

The yard is built with the pointer, so the pointer path is part of what you
build: taking the cursor off the page and delivering its position in the game's
logical units, with its press and release edges, to the game. `specs/controls.md`
states what Arc Foundry does with them.

You also write the `window.__foundry` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how the
game is driven from code, so it is present and exactly as specified.

**You produce the game's art, effects, and audio during this build.**
`specs/assets.md` is the contract: which of the six tools on this container's
`PATH` produces each sprite, animation cycle, particle system, and sound, the
exact path it lands at under `assets/`, and the bar it meets. Commit the produced
files and load them at run time. The finished repository builds and runs with
those tools absent, so nothing is generated at build time.
`@test-cabinet/particle-runtime` is already a dependency, vendored under
`.tcab/`, and it is what plays a produced particle system.

Every figure the specification fixes — the stage and grid geometry, the maps, the
component and Load stat tables, the recipes, the refinement odds, the action
names, the cue names, and the screen copy — is stated in `specs/`, and the value
stated there is authoritative.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without a
browser.

## What you must not edit

- **`index.html`** — the page and the canvas.
- **`.tcab/`** — the vendored Test Cabinet packages `package.json` resolves the
  produced-effect runtime from.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.

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
  directory runs as-is on any static host, at its root or under a sub-path.
- The produced files under `assets/` are committed, and the build loads them
  without running any of the asset tools.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
