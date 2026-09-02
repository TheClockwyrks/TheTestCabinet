# Gantry — starter project

This repository is the starting point for building **Gantry**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

This build runs on the **Simple 3D** engine, already a dependency of the project
and vendored under `.tcab/`. The engine documents itself in `engine/` at the
root of this repository; read all of it before you start. It owns the frame loop
and the delta time it hands each frame, the letterboxed canvas fit, the renderer
over the canvas with the retained scene and the camera it draws through, the 2D
screen layer composited over that picture for the readouts, the input actions,
the pointer and the world-space ray it casts through the camera, audio, loading
the produced files under one root, and the debug overlay. Asset loading includes
the decoding: the engine's model loader hands a produced `.glb` back as a node
tree with its meshes and per-vertex colors, ready to be cloned into the scene. A
produced model declares no material of its own, so those meshes arrive on the
loader's default one, which is yours to replace. `three` is installed for the
yard's geometry, and it is a peer dependency of the engine, so the engine and
your own code share the one copy this project declares.

## What you own

**`src/game.ts`, any new modules you add beside it under `src/`, and
everything under `assets/`.**

Start by declaring and exporting `GantryState`, the type the whole of the game's
state is held in, carrying every field `specs/state.md` fixes, and
`GantryDebugApi`, the debug and automation surface `specs/instrumentation.md`
specifies. The stub in `src/game.ts` is written against both names, so the
project does not compile until they exist — a fresh workspace failing
`npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `Game<GantryState, GantryDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<GantryState>`, which the engine
re-exports) and returns the next state, advanced against the frame's delta time
in seconds; and `render` is handed that next state, read-only again, and draws
it. The engine holds the state by value and replaces it with whatever `update`
returns, so a frame builds the next state from the current one rather than
writing into it, and the type is what guarantees that rendering changes nothing.
All three currently throw `"not implemented"`. Implement them.

`src/game.ts` also exports `BACKGROUND`, the CSS color the engine clears the
whole canvas to each frame, letterbox bars included; `src/main.ts` hands it over
as the engine is created. Replace the placeholder with the color your yard uses.

**The picture is drawn through the engine's scene.** `render` is handed the
retained scene, the camera the frame is drawn through, and the screen layer's 2D
context already carrying the logical stage transform, so the yard is three
objects in that scene and the readouts are drawing over the picture. What one
frame adds to the scene is still there on the next.

**The pointer comes from the engine**, already in logical stage units, with the
frame's ordered samples and its press and release edges, and the camera turns a
point on the stage into a ray through the yard and a point in the yard back onto
the stage. `specs/controls.md` states what Gantry does with them.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and
a caller applies it through `engine.apply`; a reading takes the state and
returns what it read, as `debug.snapshot(engine.state)`. Nothing is published to
the page.

You also produce the game's models and audio with the asset tools on this
machine's `PATH` and commit the produced files under `assets/`;
`specs/assets.md` is the contract, and the engine's asset loader resolves every
path under that root. The tools are absent when the build is installed and
rebuilt elsewhere, so the build bundles the committed files and invokes no tool.

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
