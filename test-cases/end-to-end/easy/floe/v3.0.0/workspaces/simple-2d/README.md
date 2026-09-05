# Floe — starter project

This repository is the starting point for building **Floe**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

`src/game.ts` declares and exports `FloeState`, exactly as `specs/state.md` fixes
it, and `FloeDebugApi`, the debug and automation surface
`specs/instrumentation.md` specifies. The seeded stub is written against both
names, so the project does not compile until they exist — a fresh workspace
failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `Game<FloeState, FloeDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<FloeState>`, from `ts-essentials`) and
returns the next state; and `render` is handed that next state, read-only again,
and draws it. The engine holds the state by value and replaces it with whatever
`update` returns, so a frame builds the next state from the current one rather
than writing into it, and the type is what guarantees that rendering changes
nothing. All three currently throw `"not implemented"`. Implement them.

**Floe runs on a fixed step, and the step is yours.** The engine hands `update`
the frame's real elapsed seconds; the simulation advances in whole ticks of
`TICK_DT` (1/120 s), running as many as that elapsed time completes and carrying
the remainder into the next frame. Every rate in `src/constants.ts` is integrated
against that tick rather than against the frame's own delta, and `simTime`
accumulates `TICK_DT` on every tick whatever the screen. `specs/overview.md`
states the rule.

**The sprite art comes from the engine's asset loader**, which resolves every
path under the fixed `assets/` root relative to the page. Await every frame
inside `initialize`, so a frame is a plain image value by the time anything draws
it. Floe's frames are separate files rather than an atlas, so each frame is its
own image.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and a
caller applies it through `engine.apply((s) => debug.setLives(s, 2))`; a reading
takes the state and returns what it read, as `debug.snapshot(engine.state)`.
Nothing is published to the page.

`FloeState` **is a contract**. Keep every field, under the name, type, and
meaning `specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over the code you write under `src/`; the
seeded `src/constants.ts` and `src/main.ts` are outside the report. The engine's
documentation carries a complete worked example of testing a game this way.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage and
  strait geometry and the tile-to-stage map, the five bands and the five bays,
  the hop cooldown, both lane tables and their per-level scaling, the bear's
  speeds and emergence conditions, the run and its scoring, the sprite frame
  counts and widths, the action names, the bindings, the cue names, and the
  screen copy. Read from it.
- **`assets/`** — the seeded sprite art. `specs/assets.md` is the contract for
  what each folder holds, which frame is drawn for which state, and how each is
  drawn. Draw the game from these frames; do not redraw them, add to them, or
  replace them.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- **`.vendor/`** — the vendored engine.

Add dependencies to `package.json` if you genuinely need them, and commit the
`package-lock.json` — the build is installed with `npm ci`. Leave the existing
entries alone.

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
