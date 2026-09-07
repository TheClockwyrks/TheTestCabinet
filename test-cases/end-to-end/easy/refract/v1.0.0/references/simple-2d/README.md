# Refract — `simple-2d` reference implementation

The authored, **correct** reference build of the Refract end-to-end test case,
on the [Simple 2D](../../../../../../../packages/simple-2d) engine. It is the
answer a run on `simple-2d` is compared against. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` implemented, the
game split across new modules beside it, and its own tests written alongside,
so what is here is exactly what a run on this engine is asked to produce.

---

**Refract** is a puzzle game of light, played in the browser on a dark optical
bench. Each board is a lattice of optical nodes on a grid. Every channel —
**triangle**, **square**, **diamond**, each with its own hue and silhouette —
has exactly two emitters, and the player draws one beam per channel: press on a
node and drag along the nodes the beam should thread, and release to leave it
as drawn. A beam runs between its channel's two emitters and passes through
every lens of that channel; channel-neutral **crystals** carry one to three
charges, and every charge must be spent by a crossing — no more, no fewer.

Refract's defining idea is that a beam is **drawn rather than fired**. The
rules run on every pointer move and silently refuse anything illegal — reaching
across an empty cell, touching another channel's nodes, reusing a segment,
crossing another beam's diagonal, over-filling a node or a crystal — so the
player sweeps the pointer and only permitted segments take. Backing the pointer
along the beam unwinds it a segment at a time. The board is solved the moment
every beam is complete and every crystal is exactly spent.

The dark-bench look — deep blue-black, amber/cyan/violet channels, hexagonal
ice crystals with charge pips — is this build's own: the specification fixes
the rules and geometry and deliberately leaves the palette, type, and artwork
to the build, so the look lives in `src/theme.ts` rather than beside the
case-fixed figures in `src/constants.ts`.

This is a self-contained static web app — plain **TypeScript** over the
engine, drawing to an **HTML5 canvas**, bundled with **Vite**. No backend,
accounts, network calls, or API keys; everything needed to play is in the
built bundle.

## Modes

- **Campaign** — a fixed course of 24 hand-built boards in four sets, worked
  through in order from a select grid. Solving a board unlocks the next; solved
  boards can be replayed; solving all 24 reaches the campaign's complete
  screen. Progress lasts the session.
- **Cascade** — one unbroken sequence of generated boards, climbing a
  five-tier ladder (wider grids, more channels, more crystals) one tier every 5
  boards solved. Every board the generator emits is **provably solvable**: the
  board is carved out of its own solution and then verified against the real
  ruleset before it is shown. Each board is drawn afresh.

## Controls

The pointer draws beams; the keyboard drives the menus. Every keyboard control
is a **registered engine action** on the `dpad-4` touch layout:

| Action                           | Keys               | Does                                                                                    |
| -------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Moves the menu or select-grid highlight.                                                |
| `confirm`                        | `Enter` or `Space` | Accepts the highlighted item; enters the highlighted board.                             |
| `back`                           | `Esc`              | Leaves the current screen — a board back to the grid (Campaign) or the title (Cascade). |
| `clear`                          | `R`                | Empties every beam on the current board, leaving its nodes.                             |
| `mute`                           | `M`                | Toggles sound, on any screen.                                                           |

**Drawing:** press on an emitter to start its channel's beam, on either end of
a beam to resume it, or part-way along a beam to shorten it to that node and
continue from there. Drag across adjacent nodes to extend; back onto the
previous node to retract; release to keep what is drawn. A move the rules
refuse simply does not take.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen, mode, board size, each beam's length and completeness, each
crystal's spends, whether the board is solved, and the pointer. That key
belongs to the engine, not to this game.

## What the engine owns

`@clockwyrks/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in
seconds, the state held by value and handed out `DeepReadonly`, the canvas fit
(uniform scale, centered letterbox, device pixel ratio), named keyboard actions
with edge detection, **the pointer** — position already in logical stage units,
press/release edges, and the ordered per-frame sample list a sweep arrives as —
audio cue synthesis with mute and the first-gesture unlock, and the debug
overlay. What is left is the game: the rules, the tracing, the boards, the
generator, the drawing, and the state the debug surface poses.

## The state is a value

Nothing in this build writes to a state it was handed. Every field of
`RefractState` is `readonly` and every array a `readonly` array, so the
declared type and the `DeepReadonly` view the engine hands out are the same
shape, and every function over the state is a **transition**: current state in,
next state out, built by spreading what it keeps around what it changes. The
pointer resolvers in `src/tracing.ts`, the screen transitions in `src/flow.ts`,
and the debug surface's poses are the transitions `update` is composed from.
There is no module-level game state and no closure over mutable data; `render`
and every diagnostic source are reads of the state they are given, and the
compiler — not a convention — is what says they cannot change it.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: `src/debug.ts` builds it, `initialize` returns
it beside the state as `[state, createDebugApi()]`, and a caller reads that
same object back off **`engine.debug`**. Nothing is published on the page.

Every operation is a pose or a reading over `RefractState`, written in the
shape of `update`:

```ts
engine.apply((s) => engine.debug.loadBoard(s, ["T.S", "1.s", "T.S"]));

// A route is the pointer trio in turn, each call handed the state the last one
// returned. `snapshot().board.nodes` reports where each cell's center sits.
const nodes = engine.debug.snapshot(engine.state).board.nodes;
const at = (col, row) => nodes.find((n) => n.col === col && n.row === row);
engine.apply((s) => {
  const down = engine.debug.pointerDown(s, at(0, 0).x, at(0, 0).y);
  const one = engine.debug.pointerMove(down, at(0, 1).x, at(0, 1).y);
  const two = engine.debug.pointerMove(one, at(0, 2).x, at(0, 2).y);
  return engine.debug.pointerUp(two);
});
const { beams, solved } = engine.debug.snapshot(engine.state);
```

The operations are `reset`, `snapshot`, the single-field poses
`setMode` / `setScreen` / `setMenuIndex` / `setSolvedCount` / `setTier`,
`loadBoard` (any board in the case's notation), `generateBoard` (a board the
generator emits at a tier), the immediate-effect pointer trio
`pointerDown` / `pointerMove` / `pointerUp`, and `clear`. The pointer
operations do not stand in for the engine's pointer — they feed the **same
resolution path** its samples feed, so the hit radius, the grab rules, the
limits, and the completion test run exactly as they do in play.
Everything about _driving a browser game_ — the clock, exact frames, key
events — is the engine's, which is why the surface carries no `step` or
`keyDown`. Both surfaces are inert during normal play.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

From the repository root, install the npm workspace and build its packages:

```sh
npm ci && npm run build:packages
```

Then, in this directory:

```sh
npm ci
```

The engine, `@clockwyrks/simple-2d`, is a relative `file:` dependency on the
repository's `packages/simple-2d`, which npm installs as a symlink, so this
project builds and tests against the engine's current source. A run receives the
same package at `.vendor/engine/@clockwyrks/simple-2d/` instead, so the import
in the sources is the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root. Serve that directory as-is from any static file
server:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Checks

```sh
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --check
npm test               # vitest, with coverage over src/
```

`npm test` runs the build's own suite **in process**: it stands a real engine
up over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it
with `engine.advance` against a `ConstantClock`, drives the keyboard and the
pointer by dispatching events at the surface's event target, poses scenarios
through `engine.apply`, and reads results back from the state, the debug
surface, the engine's cue events, and the pixels the render produced. No
browser is involved. Among the suite: **all 24 campaign boards are solved
end-to-end** by tracing a known solution through the real pointer path, and the
cascade generator is swept across draws and tiers with every emitted board
checked for structure and solved from its carved solution.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette, hues, type
  game.ts             The RefractState contract and the three functions the
                      engine drives; per-frame input and cue wiring
  board.ts            Cell geometry, the board notation, pointer targeting
  rules.ts            The ruleset: limits R1–R5, completion R6–R9
  tracing.ts          Press/move/release resolution: the grab table, extending,
                      retracting, solving mid-trace, clearing
  flow.ts             The initial state and every screen transition, shared by
                      the menus and the debug surface
  campaign.ts         The 24 hand-built boards, transcribed from the case
  cascade.ts          The tier ladder and the solvable-by-construction
                      board generator
  rng.ts              The build's private random source
  input.ts            The registered actions and their edge reads
  audio.ts            The five engine cues, played once per event per frame
  debug.ts            The debug surface: poses and readings over RefractState
  diagnostics.ts      The values the engine's overlay shows
  render.ts           All canvas drawing, in logical space
  *.test.ts           The build's own tests, beside the code they cover
```
