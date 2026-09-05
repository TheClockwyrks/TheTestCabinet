# Wireworm — starter project

This repository is the starting point for building **Wireworm**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine,
which is installed as an ordinary dependency and documents itself under
`engine/` — read that alongside the specs. What is missing is the game.

## What you own

**`src/game.ts`, and any new files you add beside it.**

**`src/game.ts` does not exist yet, and that is the starting point.**
`src/main.ts` imports `BACKGROUND` and `game` from it, so a freshly seeded
workspace fails `npm run typecheck` on the missing module. Create the file.

Start by declaring and exporting `WirewormState`, exactly as `specs/state.md`
fixes it — a class extending the engine's `GameState` — and `WirewormDebugApi`,
the debug and automation surface `specs/instrumentation.md` specifies.

`src/game.ts` then exports `game`, a `GameDefinition<WirewormDebugApi>`: the
game instance class, a level registry holding the single level the game runs in
(`LEVELS` in `src/constants.ts` names it), and `startLevel` naming it. The
engine opens that level once and the game never opens another — every screen is
a value of the state's `screen` field, so the world and its game state live for
the whole session and the node field survives a level advance without being
rebuilt. The instance's `initialize` registers the actions, defines the cues,
loads the sprite frames, and returns the debug surface. The level's game mode
runs the screens and the rules: its `gameStateClass` is `WirewormState`, so the
engine builds the state `specs/state.md` declares when the world opens; its
`beginPlay` adds a single player possessing nothing, whose controller is where
the actions are read, and registers the diagnostic sources through
`world.diagnostics`; and its `tick` accumulates `state.simTime` and mirrors the
engine's mute bit into `state.muted`. Leave the camera at rest, so world units
and the stage's logical units coincide. The state is the whole of the
authoritative game — the actors, components, and controllers you write draw it
and drive it, holding nothing authoritative of their own. Implement the game.

**The worm is clocked; everything else is a rate.** The worm advances one tile
each time its own step clock reaches the level's step interval, and a frame
covering several intervals runs several steps in order, with the remainder
carried — `specs/worm.md` states the rule, and the engine's per-world timers
express it directly. Each worm carries its own clock, started when the worm
comes into existence. The cursor, the bolts, the foes and the phase timers are
all per-second rates integrated against the tick's delta time.

**The sprite art comes from the engine's asset loader**, which resolves every
path under the fixed `assets/` root relative to the page. Await every frame in
the level's load, so a frame is a plain image value by the time anything draws
it. Wireworm's frames are separate files rather than an atlas, so each frame is
its own image; mirroring a leftward worm or corruptor is a negative x scale on
the sprite component rather than a second set of frames.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as the instance's `initialize` handed it over, and that
is how the game is driven from code, so it is present and exactly as
`specs/instrumentation.md` specifies. Its operations act on the live game at the
call: a pose takes only its own arguments, arranges the running game through the
same systems play uses, and returns nothing, as
`engine.debug.setNode(c, r, charge)`; a reading returns plain data and changes
nothing, as `engine.debug.snapshot()`. Nothing is published to the page.

`WirewormState` **is a contract**. Keep every field, under the name, type, and
meaning `specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. A test stands the engine up
over a canvas from `@napi-rs/canvas`, with a `SurfaceMetrics` and a scripted
clock of the test's own, then advances the game a counted number of frames with
`engine.advance`, so it needs no browser. A test that draws a node also needs
the sprite art, which the loader reaches for through `fetch` and
`createImageBitmap`: stand both globals up over the project's own `assets/`
directory for the life of the file and restore them afterwards. The engine's
documentation defines every other piece of that recipe.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes: the stage and
  board geometry and the tile-to-stage map, the worm's cadence and length, the
  charge and discharge figures, the cursor's bounds and rate, the run and its
  scoring, every foe's speeds and gates, the sprite frame counts and rates, the
  level and tag names, the action names, the bindings, the cue names, and the
  screen copy. Read from it.
- **`assets/`** — the seeded sprite art. `specs/assets.md` is the contract for
  what each folder holds and which frame is drawn for which state. Draw the game
  from these frames; do not redraw them, add to them, or replace them.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **The toolchain** — `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`.
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
