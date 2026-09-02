# Gantry — starter project

This repository is the starting point for building **Gantry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on the **Structured 3D** engine, already a dependency of the
project and vendored under `.tcab/`. The engine documents itself in `engine/`
at the root of this repository; read all of it before you start. It owns the
gameplay framework the game is written inside — a game instance that outlives
every level, the world a level opens into, the game mode and game state that
hold a match, the actors and components a world contains, and the controllers
that read input — together with the frame loop and the delta time it hands
each tick, the rendering pipeline and the camera it draws through, collision
detection, the input actions, the pointer, audio, loading the produced files
under one root, and the debug overlay. Asset loading includes the decoding: the
engine's model loader hands a produced `.glb` back as a node tree with its
meshes, per-vertex colors, and materials, which a model component clones onto
an actor. `three` is installed for the yard's geometry, and it is a peer
dependency of the engine, so the engine and your own code share the one copy
this project declares.

## What you own

**`src/game.ts`, any new modules you add beside it under `src/`, and
everything under `assets/`.**

Start by declaring and exporting `GantryState`, the class the whole of the
game's authoritative state is held in — a class extending the engine's
`GameState`, carrying every field `specs/state.md` fixes — and
`GantryDebugApi`, the debug and automation surface `specs/instrumentation.md`
specifies. The stub in `src/game.ts` is written against both names, so the
project does not compile until they exist — a fresh workspace failing
`npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<GantryDebugApi>`: the game
instance class, a level registry holding the single level the game runs in, and
`startLevel` naming it. The engine opens that level once and the game never
opens another — every screen is a value of the state's `screen` field, so the
world and its game state live for the whole session. The instance's
`initialize` registers the actions, loads the cues and the produced models, and
returns the debug surface. The level's game mode runs the screens
and the rules: its `gameStateClass` is `GantryState`, so the engine builds that
state when the world opens; its `beginPlay` adds a single player possessing
nothing, whose controller is where the actions and the pointer are read, and
registers the diagnostic sources through `world.diagnostics`; and its `tick`
accumulates the frame's delta time, consumes whole simulation ticks from it
while a run is in progress, and mirrors the engine's mute bit into the state.
The framework's states are live objects — a tick writes the fields it advances
in place — and the actors, components, and controllers you write draw that
state and drive it, holding nothing authoritative of their own.

`src/game.ts` also exports `BACKGROUND`, the CSS color the engine clears the
whole canvas to each frame, letterbox bars included; `src/main.ts` hands it over
as the engine is created. Replace the placeholder with the color your yard uses.

**The picture is the engine's.** The yard is described as render components on
actors — meshes, lights, and the produced models in world space, and text,
shapes, and direct drawing on the screen layer over them — and the camera is
the world's own, which the mode poses. `specs/controls.md` fixes the orbit and
what a click picks; the pointer reaches you through the player controller's
input reader, already in logical stage units, and the world camera converts
between a point on the stage and a line in the yard.

You also produce the game's models and audio with the asset tools on this
machine's `PATH` and commit the produced files under `assets/`;
`specs/assets.md` is the contract, and the engine's asset loader resolves every
path under that root. The tools are absent when the build is installed and
rebuilt elsewhere, so the build bundles the committed files and invokes no
tool.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, in Node, with coverage over `src/`. The engine renders
through WebGL: it takes a `webgl2` context from the canvas the moment it is
created and Node has none, so the engine itself cannot be stood up there.
`@napi-rs/canvas` is installed for a test that wants a real 2D context to draw
through.

## What you must not edit

- **`src/main.ts`** — the fixed entry point. It creates the engine over the
  page's canvas, binds `game` to it, and runs.
- **`src/constants.ts`** — every figure the specification fixes, named once.
  Import from it everywhere.
- **`index.html`** — the page and the canvas the engine fits the stage into.
- **`.tcab/`** and **`engine/`** — the vendored engine and its documentation.
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
