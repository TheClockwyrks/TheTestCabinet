# Wick — starter project

This repository is the starting point for building Wick, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on no engine. Nothing here supplies a frame loop, input, audio,
asset loading, or an overlay, and there is no game code to start from. What the
project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below.

## What you own

Everything under `src/`. The directory does not exist yet; create it.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs and the game itself on top of it:

- the frame loop and the delta time it measures;
- fitting the fixed logical stage onto the canvas;
- keyboard input;
- audio, with cues that loop;
- loading the sprites and sounds you produce;
- the diagnostics overlay;
- the world under its camera, the weapons, the passives, the enemies and their
  director, the level-up economy, and the screens.

You also write the `window.__wick` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how
the game is driven from code, so it is present and exactly as specified.

You also produce the game's sprites, icons, and audio with the asset tools on
this machine's `PATH` and commit the produced files under `assets/`;
`specs/assets.md` is the contract. The tools are absent when the build is
installed and rebuilt elsewhere, so the build bundles the committed files and
invokes no tool.

Every figure the specification fixes is stated in `specs/`: the stage and the
tick, the lamplighter's figures, every weapon's level table, the passive terms,
the enemy roster and the spawn windows, the action names, the cue names, and
the screen copy. Name each one once in your own module and read from it,
rather than restating a number at each use.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without
a browser.

## What you must not edit

- `index.html`, the page and the canvas.
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
- The produced files under `assets/` are committed alongside your source.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
