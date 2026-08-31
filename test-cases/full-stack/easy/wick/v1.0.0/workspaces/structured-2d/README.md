# Wick — starter project

This repository is the starting point for building Wick, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the Structured 2D engine, which
is installed as an ordinary dependency and documents itself under `engine/`;
read that alongside the specs. What is missing is the game, and the sprites and
sounds it plays.

## What you own

`src/game.ts`, and any new files you add beside it.

Start by declaring and exporting `WickState`, a class extending the engine's
`GameState`, exactly as `specs/state.md` fixes it, and `WickDebugApi`, exactly
as `specs/instrumentation.md` fixes it. The stub in `src/game.ts` is written
against both names, so the project does not compile until they exist; a fresh
workspace failing `npm run typecheck` is the starting point.

`src/game.ts` then exports `game`, a `GameDefinition<WickDebugApi>`: the game
instance class, a level registry holding the single level the game runs in,
keyed by the `LEVEL_NAME` `src/constants.ts` fixes, and `startLevel` naming it.
The engine opens that one level and the game never opens another, so the world
and its game state live for the whole session and every screen is a value of
the state's `screen` field. The instance's `initialize` registers the actions,
binds the cues, loads the produced assets, and returns the debug surface. The
level's game mode runs the screens and the rules, adds a single player in its
`beginPlay`, whose controller is the one place the actions are read, and
registers the diagnostic sources there. The mode's `gameStateClass` is
`WickState`, and the framework's states are live objects, so a tick writes the
fields it advances in place. The instance throws `"not implemented"` as it
stands. Implement it, and split the work across new modules under `src/`
however you like.

The fixed tick is yours. The engine hands the mode the real elapsed seconds of
each frame and imposes no timestep of its own. Wick advances in whole ticks of
`TICK_DT`, so the mode's `tick` accumulates those seconds while the screen is
`playing`, resolves each whole tick in the order `specs/world.md` fixes, and
carries the remainder, discarding it on a tick that leaves `playing`. Every
contact is the simulation's own circle and rectangle math over the state; no
collider component and no engine collision event decides one. Each actor
carries its tag from `TAGS`.

The camera follows the lamplighter. The lamplighter actor carries a
`CameraComponent` and the mode has the camera follow it at zoom `1`, so a world
point draws exactly where the camera formula of `specs/world.md` puts it, and
the facing mirror lives on the lamplighter's own sprite component rather than
on the followed actor's transform. The HUD, the menus, and the overlays are
ordinary components on an actor the mode keeps at the camera target's
position, each component's `offset` in stage units from the stage center, so
they draw at fixed logical positions and keep their place in the layer order.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Its operations act on the live world at the moment they are called:
a pose takes only the parameters the specification names for it and returns
nothing, and a reading returns plain data. Nothing is published to the page.

`WickState` is a contract. Keep every field, under the name, type, and meaning
`specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset` restores exactly those. Loaded
images and decoded audio are the one exception: they live in a module the
actors read, since they are not game state.

The assets are yours to produce. Wick ships no art and no sound: you produce
every sprite, sheet, icon, and cue with the asset tools on this machine's
`PATH`, commit the files under `assets/` at the root of this repository, and
load them in the instance's `initialize`, each image through the engine's
asset loader and each sound with `api.audio.load`, awaited so everything is
decoded before the first frame. `specs/assets.md` is the contract,
`src/constants.ts` names every path, and the engine's `assets.md` and
`audio.md` state the asset root, the path rules, and the looping cues. The
tools are absent when the build is installed and rebuilt elsewhere, so the
build bundles the committed files and invokes no tool.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's documentation
shows how a test stands the engine up over a canvas from `@napi-rs/canvas` and
a surface and clock of its own, poses a scenario through the debug surface,
and advances it a counted number of frames with `engine.advance`.

## What you must not edit

- `src/main.ts`, the fixed entry point. It creates the engine over the page's
  canvas, binds `game` to it, and runs.
- `src/constants.ts`, every figure the specification fixes: the stage and the
  tick, the lamplighter's figures, the weapon level tables and evolved rows,
  the passive terms, the enemy roster and the spawn windows, the pickups, the
  action names, the cue names, the produced-asset paths and canvases, the
  level name and actor tags, and the screen copy. Read from it.
- `index.html`, the page and the canvas the engine fits the stage into.
- The toolchain: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`,
  `.prettierignore`, and `.gitignore`.
- `.tcab/` and `engine/`, the vendored engine and its documentation.

Add dependencies to `package.json` if you genuinely need them, and commit the
`package-lock.json`; the build is installed with `npm ci`. Leave the existing
entries alone.

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
- The produced files under `assets/` are committed alongside your source, and
  the game loads them.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
