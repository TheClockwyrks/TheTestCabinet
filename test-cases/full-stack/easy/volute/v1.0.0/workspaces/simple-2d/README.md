# Volute — starter project

This repository is the starting point for building Volute, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the Simple 2D engine, which is
installed as an ordinary dependency and documents itself under `engine/`; read
that alongside the specs. What is missing is the game, and the art, effects, and
sound it plays.

## What you own

`src/game.ts`, and any new files you add beside it.

The module does not exist yet. `src/main.ts` imports `game` and `BACKGROUND`
from it, so the project does not compile until you create it — a fresh
workspace failing `npm run typecheck` is the starting point, not a broken seed.

Start by declaring and exporting `VoluteState`, exactly as `specs/state.md`
fixes it, and `VoluteDebugApi`, exactly as `specs/instrumentation.md` fixes it.

`src/game.ts` then exports `game`, a `Game<VoluteState, VoluteDebugApi>`: three
functions over that state. `initialize` builds the state and the debug surface
once and returns them together as `[state, debug]`; `update` takes the current
state as a read-only view (`DeepReadonly<VoluteState>`, from `ts-essentials`)
and returns the next state, advanced against the frame's delta time in seconds;
and `render` is handed that next state, read-only again, and draws it. The
engine holds the state by value and replaces it with whatever `update` returns,
so a frame builds the next state from the current one, spreading the parts that
change, rather than writing into it, and the type is what guarantees that
rendering changes nothing. Split the work across new modules under `src/`
however you like.

`src/game.ts` also exports `BACKGROUND`, a CSS color string: the field
background `src/main.ts` hands the engine as the color the canvas is cleared to
each frame, so the letterbox bars around the field match the field itself.

The assets are yours to produce. Volute ships no art and no sound: you produce
every sprite, sheet, particle system, and cue with the asset tools on this
machine's `PATH`, commit the files under `public/assets/`, and load them in
`initialize`, each image with `api.assets.loadImage` and each sound with
`api.audio.load`, awaited so everything is decoded before the first frame.
`specs/assets.md` is the contract, and the engine's `assets.md` and `audio.md`
state the asset root, the path rules, and the looping cues. A produced particle
system is played through `@test-cabinet/particle-runtime`, an installed
dependency imported by its bare name. The asset tools are absent when the build
is installed and rebuilt elsewhere, so the build bundles the committed files and
invokes no tool.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and
a caller applies it through `engine.apply((s) => debug.start(s))`; a reading
takes the state and returns what it read, as `debug.snapshot(engine.state)`.
Nothing is published to the page.

`VoluteState` is a contract. Keep every field, under the name, type, and meaning
`specs/state.md` gives it. You may add fields, but only for data you can rebuild
from the declared ones: the declared fields are the whole of the authoritative
state, and the surface's `reset` restores exactly those. Loaded images, decoded
audio, and prepared particle systems are the one exception: `initialize` may
hold them in a module-level table `render` reads, since they are not game state.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's `debug.md` and
`frame.md` show how a test stands the engine up over a `ConstantClock`, poses a
scenario through the debug surface, and advances it a counted number of frames.

## What you must not edit

- `src/main.ts`, the fixed entry point. It creates the engine over the page's
  canvas, binds `game` to it, and runs.
- `src/constants.ts`, every figure the specification fixes: the field and the
  tick, the channel and its arc length, the cores and their spacing, the
  charges, pressure, the injector, extraction and chains, the machinery table,
  the level table, the run's figures, the screen names, the action names and
  bindings, and the cue names. Read from it, and never restate a number it
  already names.
- `index.html`, the page and the canvas the engine fits the field into.
- The toolchain: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  and `.gitignore`.
- `.tcab/` and `engine/`, the vendored libraries and the engine's documentation.

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
- Replace this file with the `README.md` `specs/overview.md` asks the finished
  build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
