# Floe — starter project

This repository is the starting point for building **Floe**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on **no engine**. Nothing here supplies a frame loop, input,
audio, asset loading, or an overlay, and there is no game code to start from.
What the project supplies is the toolchain, already configured and installed:
TypeScript, Vite, Vitest, ESLint and Prettier, wired to the commands below — and
the sprite art under `assets/`.

## What you own

**Everything under `src/`.** The directory does not exist yet; create it.

`index.html` loads `/src/main.ts` as its entry point, so that module is where
your build starts. Beyond that the structure is yours. You write the runtime a
browser game needs: the frame loop and the delta time it measures, fitting the
fixed logical stage onto the canvas, keyboard, pointer and touch input, audio,
and the diagnostics overlay. You write the game itself on top of it.

**Floe runs on a fixed step.** The simulation advances in whole ticks of
`TICK_DT` (1/120 s), and a frame runs as many of them as its elapsed time
completes, carrying the remainder into the next frame. Every rate the
specification states is integrated against that tick rather than against the
frame's own delta; `specs/overview.md` states the rule.

You also write the `window.__floe` debugging and automation API that
`specs/instrumentation.md` specifies. It is a required deliverable: it is how the
game is driven from code, so it is present and exactly as specified. Under `none`
it is also where the two clock operations live, `setAutoStep` and `advance`,
because nothing outside your build owns the clock.

Every figure the specification fixes is stated in `specs/`, and the value stated
there is authoritative: the stage and strait geometry, the tile pitch and the
tile-to-stage map, the five bands and the five bays, the hop cooldown, every
lane's kind and speed and gap, the bear's speeds and emergence conditions, the
run and its timer, every score figure, the screen copy.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test` runs
them in process, in Node, with coverage over `src/`. `@napi-rs/canvas` is
installed, so a test that needs a real 2D context can draw through one without a
browser.

## What you must not edit

- **`assets/`** — the seeded sprite art. `specs/assets.md` is the contract for
  what each folder holds, which frame is drawn for which state, and how each is
  drawn. Draw the game from these frames; do not redraw them, add to them, or
  replace them. Load them page-relative, so the produced site runs at any base
  path.
- **`index.html`** — the page and the canvas.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`. `vite.config.ts` is what serves `assets/` in development and
  copies the same tree into `dist/` when the site is built.

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

- `npm run build` produces `dist/` with `index.html` at its root and the sprite
  art under `dist/assets/`, and that directory runs as-is on any static host.
- `npm run typecheck`, `npm run lint`, `npm run format`, and `npm test` all pass.
  The same four commands are run over the repository you leave behind.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
