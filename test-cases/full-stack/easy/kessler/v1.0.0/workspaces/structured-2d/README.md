# Kessler — starter project

This repository is the starting point for building **Kessler**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Structured 2D** engine,
which is installed as an ordinary dependency and documents itself under
`engine/` — read that alongside the specs. What is missing is the game, and the
art and sound it plays.

## What you own

**`src/game.ts`, and any new files you add beside it.**

`src/game.ts` declares and exports `KesslerState` — a class extending the
engine's `GameState`, carrying the whole authoritative state the specification's
rules require of the game — and `KesslerDebugApi`, the debug and automation
surface `specs/instrumentation.md` specifies. The seeded stub is written against
both names, so the project does not compile until they exist — a fresh workspace
failing `npm run typecheck` is the starting point, not a broken seed.

`src/game.ts` then exports `game`, a `GameDefinition<KesslerDebugApi>`: the game
instance class, a level registry holding the single level the game runs in —
keyed by the `LEVEL_NAME` `src/constants.ts` fixes — and `startLevel` naming it.
The engine opens that one level and the game never opens another, so the world
and its game state live for the whole session and every screen is a value of the
state's screen field. The instance's `initialize` registers the actions, defines
the cues, loads the produced assets, and returns the debug surface. The level's
game mode runs the screens and the rules, and it adds a single player in its
`beginPlay`, whose controller is where the actions are read. The mode's
`gameStateClass` is `KesslerState`, and the framework's states are live objects,
so a tick writes the fields it advances in place. The instance currently throws
`"not implemented"`. Implement it.

**The fixed tick is yours.** The engine hands the mode the real elapsed seconds
of each frame and imposes no timestep of its own. Kessler advances in whole
ticks of `TICK_DT`, so the mode's `tick` accumulates those seconds and resolves
each whole tick in the order `specs/field.md` fixes, carrying the remainder.
Every contact is the simulation's own polar crossing math over the state — no
collider components and no engine collision events decide one — each actor
carries its tag from `TAGS`, and the game leaves the camera at rest, so world
units and the stage's logical units coincide.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Its operations act on the live world at the moment they are called: a
pose takes only the parameters the specification names for it and returns
nothing, and a reading returns plain data. Nothing is published to the page.

**You also produce every asset the game plays.** Asset-generation tools are on
your `PATH` while you build here. `specs/assets.md` is the contract: what to
produce, which tool produces it, the path it lands at, and how it is wired in.
The finished files are committed to this repository and loaded through the
engine's asset loader at runtime, and `npm run build` never invokes the tools.

`@clockwyrks/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a produced
`system.json` into a 2D drawing context — the one a component that draws
directly is handed, since the engine's declarative pipeline does not draw
particles. Import it like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's documentation
carries a complete worked example of testing a game this way.

## What stays as it is

`specs/overview.md` lists the files this project supplies and keeps, including
`src/main.ts`, `src/constants.ts`, `index.html`, `engine/`, `.vendor/` and the
toolchain, and states the one change `package.json` takes.

## Commands

- `npm run dev` — serves the game with hot reload.
- `npm run build` — type-checks, then emits the static site into `dist/`.
- `npm run preview` — serves `dist/` for a final check.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint.
- `npm run format` — Prettier, in check mode.
- `npm test` — Vitest over `src/**/*.test.ts`, with coverage.

## This file

This starter README is replaced by the `README.md` `specs/overview.md` asks the
finished build to ship: what the game is, how to install it, how to run it in
development, how to produce the production build, and the controls.
