# Coil — starter project

This repository is the starting point for building **Coil**, the game the
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
fixed logical stage onto the canvas, keyboard input, image loading, audio, and
the diagnostics overlay — and you write the game itself on top of it.

Coil advances on a fixed tick fed by elapsed time, so the loop you write is what
the whole simulation rests on: `specs/movement.md` states the tick, the order it
resolves in, and the rule that drawing advances nothing.

**The assets under `assets/`.** That directory does not exist yet either. Coil
ships no art and no sound: the snake's sprite set and the game's cues and music
are produced during this build with the generation binaries on the `PATH`,
committed here, and bundled. `specs/assets.md` is that contract, and it also
names what stays drawn in code.

You also write the `window.__coil` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how the
game is driven from code, so it is present and exactly as specified.

Every figure the specification fixes — the stage and board geometry, the tick,
the turn buffer, the combo and its window, the action names and their keys, the
cue names, and every piece of screen copy — is stated in `specs/`, and the value
stated there is authoritative.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without a
browser.

## What you must not edit

- **`index.html`** — the page and the canvas.
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
  directory runs as-is on any static host, at its root and under a sub-path.
- The produced files under `assets/` are committed, and the build bundles them
  rather than regenerating them.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
