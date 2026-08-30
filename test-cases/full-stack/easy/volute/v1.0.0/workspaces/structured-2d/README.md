# Volute — starter project

This repository is the starting point for building Volute, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the Structured 2D engine, which is
installed as an ordinary dependency and documents itself under `engine/`; read
that alongside the specs. What is missing is the game, and the art, effects, and
sound it plays.

## What you own

`src/game.ts`, and any new files you add beside it.

The module does not exist yet. `src/main.ts` imports `game` and `BACKGROUND`
from it, so the project does not compile until you create it — a fresh
workspace failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` exports `game`, the `GameDefinition` the engine drives: the level
registry, keyed by exactly the names `WORLDS` holds, with the title level opened
first, and your own `GameInstance` subclass. Behind that definition you write
the whole game — the game modes that hold the rules and the screens, the actors
that populate the hall, each carrying its tag from `TAGS` so `world.byTag` finds
it under the names the specification uses, the components that draw them, and
the controllers that drive the injector. The instance's `initialize` registers
every action in `ACTIONS` against its binding in `BINDINGS`, declares the cues
in `CUES` and `EXTRACT_CUES`, registers the diagnostic sources the
specification lists, and returns the debug surface.

`src/game.ts` also exports `BACKGROUND`, a CSS color string: the field
background `src/main.ts` hands the engine as the color the canvas is cleared to
each frame, so the letterbox bars around the field match the field itself.

The assets are yours to produce. Volute ships no art and no sound: you produce
every sprite, sheet, particle system, and cue with the asset tools on this
machine's `PATH`, commit the files under `public/assets/`, and load them through
the engine's asset loaders, each image with `loadImage` and each sound with
`audio.load`, awaited so everything is decoded before the frame that needs it.
`specs/assets.md` is the production contract, and the engine's `assets.md` and
`audio.md` state the asset root, the path rules, and the looping cues. A
produced particle system is played through `@test-cabinet/particle-runtime`'s
`./canvas` binding, which is installed as an ordinary dependency and composites
a running system into a 2D rendering context. The tools are absent when the
build is installed and rebuilt elsewhere, so the build bundles the committed
files and invokes no tool.

The debug surface is a required deliverable. The engine hands back from
`engine.debug` exactly what `initialize` returned, and that is how the game is
driven from code, so it is present and exactly as the specification's
instrumentation contract states. Each of its operations is a method acting on
the running game: a pose takes only the arguments its heading names, returns
nothing, and arranges the live world through the same systems play uses; a
reading takes none and returns plain data read off the world at the call, as
`engine.debug.snapshot()`. Nothing is published to the page.

`WORLDS` and `TAGS` are contracts, like every other name in `src/constants.ts`.
Every level is registered under its name in `WORLDS`, and every core,
projectile, injector, and intake actor carries its tag from `TAGS`, so the
hall's bodies are findable exactly as the specification says they are.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. A test stands the engine up
over its own canvas, scripted clock, and surface, steps it with
`engine.advance`, and reads the result back from the world and the debug
surface. The engine's documentation carries a complete worked example of
testing a game this way.

## What you must not edit

- `src/main.ts`, the fixed entry point. It creates the engine over the page's
  canvas, binds `game` to it, and runs.
- `src/constants.ts`, every figure the specification fixes: the field, the
  channel, the charges, the train and its pressure, the injector, extraction
  and chains, the machinery, the five levels, the run, the screens, the level
  names, the actor tags, the action names and bindings, and the cue names. Read
  from it, and never restate a number it already names.
- `index.html`, the page and the canvas the engine fits the field into.
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
- The produced files under `public/assets/` are committed alongside your
  source.
- Replace this file with the `README.md` `specs/overview.md` asks the finished
  build to ship: what the game is, how to install it, how to run it in
  development, how to produce the production build, and the controls.
