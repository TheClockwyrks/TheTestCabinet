# Kessler — starter project

This repository is the starting point for building **Kessler**, the game the
specification under `specs/` describes. Read `specs/overview.md` first; it says
how the rest of the specification is organized.

The project is already wired up. It builds on the **Simple 2D** engine, which is
installed as an ordinary dependency and documents itself under `engine/` — read
that alongside the specs. What is missing is the game, and the art and sound it
plays.

## What you own

**`src/game.ts`, and any new files you add beside it.**

`src/game.ts` declares and exports `KesslerState`, the whole authoritative state
the specification's rules require of the game, and `KesslerDebugApi`, the debug
and automation surface `specs/instrumentation.md` specifies. The seeded stub is
written against both names, so the project does not compile until they exist — a
fresh workspace failing `npm run typecheck` is the starting point, not a broken
seed.

`src/game.ts` then exports `game`, a `Game<KesslerState, KesslerDebugApi>`:
three functions over that state. `initialize` builds the state and the debug
surface once and returns them together as `[state, debug]`; `update` takes the
current state as a read-only view (`DeepReadonly<KesslerState>`, from
`ts-essentials`) and returns the next state, advanced against the frame's delta
time in seconds; and `render` is handed that next state, read-only again, and
draws it. The engine holds the state by value and replaces it with whatever
`update` returns, so a frame builds the next state from the current one rather
than writing into it, and the type is what guarantees that rendering changes
nothing. All three currently throw `"not implemented"`. Implement them.

**The fixed tick is yours.** The engine hands `update` the real elapsed seconds
of each frame and imposes no timestep of its own. Kessler advances in whole
ticks of `TICK_DT`, so `update` accumulates those seconds and resolves each
whole tick in the order `specs/field.md` fixes, carrying the remainder. Every
contact is the simulation's own polar crossing math over the state, and drawing
advances nothing.

The debug surface is a required deliverable. The engine returns it from
`engine.debug` exactly as `initialize` handed it over, and that is how the game
is driven from code, so it is present and exactly as `specs/instrumentation.md`
specifies. Because nothing holds a writable state, its operations are written in
the shape of `update`: a pose takes the current state and returns the next, and a
caller applies it through `engine.apply((s) => debug.setScore(s, 500))`; a
reading takes the state and returns what it read, as
`debug.snapshot(engine.state)`. Nothing is published to the page.

**You also produce every asset the game plays.** Asset-generation tools are on
your `PATH` while you build here. `specs/assets.md` is the contract: what to
produce, which tool produces it, the path it lands at, and how it is wired in.
The finished files are committed to this repository and loaded through the
engine's asset loader at runtime, and `npm run build` never invokes the tools.

`@test-cabinet/particle-runtime` is already a dependency, vendored into this
repository and resolved by a `file:` entry in `package.json`. It plays a produced
`system.json` into a 2D drawing context — the one `render` receives. Import it
like any other dependency.

Tests you write belong beside your sources as `src/**/*.test.ts`. `npm test`
runs them in process, with coverage over `src/`. The engine's documentation
carries a complete worked example of testing a game this way.

## What stays as it is

`specs/overview.md` lists the files this project supplies and keeps, including
`src/main.ts`, `src/constants.ts`, `index.html`, `engine/`, `.tcab/` and the
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
