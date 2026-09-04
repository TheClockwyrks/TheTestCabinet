# Facet — starter project

This repository is the starting point for building Facet, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the Structured 2D engine, which is
installed as an ordinary dependency and documents itself under `engine/`; read
that alongside the specs. What is missing is the game, and the art, effects, and
sound it plays.

## What you own

`src/game.ts`, and any new files you add beside it.

Start by declaring and exporting `FacetState`, exactly as `specs/state.md` fixes
it, a class extending the engine's `GameState`, and `FacetDebugApi`, the debug
and automation surface `specs/instrumentation.md` specifies. The stub in
`src/game.ts` is written against both names, so the project does not compile
until they exist. A fresh workspace failing `npm run typecheck` is the starting
point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<FacetDebugApi>`: the game
instance class, a level registry holding the single level the game runs in, and
`startLevel` naming it. The engine opens that level once and the game never
opens another, since every screen is a value of the state's `screen` field, so
the world and its game state live for the whole session. The instance's
`initialize` registers the actions, defines the cues, and returns the debug
surface. The level's game mode runs the screens and the rules: its
`gameStateClass` is `FacetState`, so the engine builds the state
`specs/state.md` declares when the world opens; its `beginPlay` adds a single
player possessing nothing, whose controller is where the actions and the pointer
are read, and registers the diagnostic sources through `world.diagnostics`; and
its `tick` accumulates
`state.simTime` and mirrors the engine's mute bit into `state.muted`. Leave the
camera at rest, so world units and the stage's logical units coincide. The state
is the whole of the authoritative game: the actors, components, and controllers
you write draw it and drive it, holding nothing authoritative of their own.
Implement the game.

The pointer comes from the engine. A gem is selected and swapped with the
pointer, and the player controller reads it from its input reader already in
logical stage units, as the frame's ordered samples carrying the press and
release edges; read the engine's input documentation for the API.
`specs/controls.md` states what Facet does with them.

The assets are yours to produce. Facet ships no art and no sound: you produce
every gem sprite, break sheet, particle system, cue, and piece of music with the
asset tools on this machine's `PATH`, commit the files under `public/assets/`,
and wire them in, the images and sounds through the engine's asset loading and
its audio, and the `system.json` particle systems through
`@test-cabinet/particle-runtime`, which is already a dependency of this project.
`specs/assets.md` is the contract, and it also fixes the loading rule: every
reference is page-relative, so the built site runs from a sub-path. The tools
are absent when the build is installed and rebuilt elsewhere, so the build
bundles the committed files and invokes no tool.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as the instance's `initialize` handed it over, and that
is how the game is driven from code, so it is present and exactly as
`specs/instrumentation.md` specifies. Its operations act on the live game at
the call: a pose takes only its own arguments, arranges the running game
through the same systems play uses, and returns nothing, as
`engine.debug.loadBoard(rows)`; a reading returns plain data and changes
nothing, as `engine.debug.snapshot()`. Nothing is published to the page.

`FacetState` is a contract. Keep every field, under the name, type, and meaning
`specs/state.md` gives it. You may add fields, but only for data you can
rebuild from the declared ones: the declared fields are the whole of the
authoritative state, and the surface's `reset()` restores exactly those.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. A test stands the engine up
over a canvas from `@napi-rs/canvas`, with a `SurfaceMetrics` and a scripted
clock of the test's own, then advances the game a counted number of frames with
`engine.advance`, so it needs no browser. The engine's documentation defines
every piece of that recipe.

## What you must not edit

- `src/main.ts`, the fixed entry point. It creates the engine over the page's
  canvas, binds `game` to it, and runs.
- `src/constants.ts`, every figure the specification fixes: the stage and board
  geometry, the gem kinds and cuts, the strain and scoring figures, the chain
  timings, the action names, the cue names, and the screen copy. Read from it.
- `index.html`, the page and the canvas the engine fits the stage into.
- The toolchain: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- `.tcab/` and `engine/`, the vendored packages and the engine's own
  documentation.

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
- The produced files under `public/assets/` are committed alongside your source.
- **Replace this file** with the `README.md` `specs/overview.md` asks the
  finished build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
