# Refract — `structured-2d` reference implementation

The authored, **correct** reference build of the Refract end-to-end test case,
on the [Structured 2D](../../../../../../../packages/structured-2d) engine. It
is the answer a run on `structured-2d` is compared against. It is **never
seeded into a run** — handing a model the finished game would defeat the test —
and takes no part in the case's seed set. The case specs under `../../specs/`
remain authoritative for the design.

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

This is a self-contained static web app — plain **TypeScript** inside the
engine's gameplay framework, drawing to an **HTML5 canvas**, bundled with
**Vite**. No backend, accounts, network calls, or API keys; everything needed
to play is in the built bundle.

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

`@clockwyrks/structured-2d` is a gameplay framework as much as a runtime, and
none of what it owns is written here: the frame loop and its replaceable clock,
the construction and ticking of the framework objects in a fixed order, the
rendering pipeline and the camera, the canvas fit (uniform scale, centered
letterbox, device pixel ratio), named keyboard actions read through a player
controller with consume-on-read edges, **the pointer** — position already in
logical stage units, press/release edges, and the ordered per-frame sample list
a sweep arrives as — audio cue synthesis with mute and the first-gesture
unlock, and the debug overlay. What is left is the game: the rules, the
tracing, the boards, the generator, the drawing, and the state the debug
surface poses.

## One world, one live state

The game is a single `GameDefinition` with a single level, opened once and
never left: every screen is a value of `state.screen`. `RefractMode` names
`RefractState` — the class `specs/state.md` declares, extending the engine's
`GameState` — as its `gameStateClass`, so `engine.world.state` is the one live
instance and the whole of the authoritative game. The framework's states are
live objects: the player controller resolves each frame's actions and pointer
samples straight onto it, the mode's tick accumulates `simTime` and mirrors the
engine's mute bit, and the debug surface's poses arrange it at the call.
Nothing lives in a module-level variable or a closure; the actors, components,
and controller hold no authoritative state of their own.

The mode's `beginPlay` adds **one player possessing nothing** — the pointer
draws on the board rather than driving a pawn — and that player's controller,
`RefractController`, is the one place input is read. The mode never calls
`setPhase`, so the inherited match `phase` stays `"waiting"` and Refract's
screens run on `screen` alone. The camera is left at rest, so world units and
the stage's 1280x720 logical units coincide; the level's one actor, the
`Bench`, carries two `DrawComponent`s (board under UI) whose draws are pure
reads of the state through `src/render.ts`.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: the instance's `initialize` returns it, the
engine holds it, and a caller reads that same object back off **`engine.debug`**.
Nothing is published on the page.

Every operation acts on the live world at the moment it is called:

```ts
engine.debug.loadBoard(["T.S", "1.s", "T.S"]);

// A route is the pointer trio in turn. `snapshot().board.nodes` reports where
// each cell's center sits.
const nodes = engine.debug.snapshot().board.nodes;
const at = (col, row) => nodes.find((n) => n.col === col && n.row === row);
engine.debug.pointerDown(at(0, 0).x, at(0, 0).y);
engine.debug.pointerMove(at(0, 1).x, at(0, 1).y);
engine.debug.pointerMove(at(0, 2).x, at(0, 2).y);
engine.debug.pointerUp();
const { beams, solved } = engine.debug.snapshot();
```

The operations are `reset`, `snapshot`, the single-field poses
`setMode` / `setScreen` / `setMenuIndex` / `setSolvedCount` / `setTier`,
`loadBoard` (any board in the case's notation), `generateBoard` (a board the
generator emits at a tier), the immediate-effect pointer trio
`pointerDown` / `pointerMove` / `pointerUp`, and `clear`. The pointer
operations do not stand in for the engine's pointer — they feed the **same
per-sample resolution path** the player controller feeds
(`src/tracing.ts`), so the hit radius, the grab rules, the limits, and the
completion test run exactly as they do in play, and each call takes effect
before it returns. Everything about _driving a browser game_ — the clock, exact
frames, key events — is the engine's, which is why the surface carries no
`step` or `keyDown`. The surface is inert during normal play.

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

The engine, `@clockwyrks/structured-2d`, is a relative `file:` dependency on
the repository's `packages/structured-2d`, which npm installs as a symlink, so
this project builds and tests against the engine's current source. A run
receives the same package at `.vendor/engine/@clockwyrks/structured-2d/`
instead, so the import in the sources is the same either way.

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
through the debug surface at `engine.debug`, and reads results back from the
world's state, the surface's snapshot, the engine's cue events, and the pixels
the render produced. No browser is involved. Among the suite: **all 24 campaign
boards are solved end-to-end** by tracing a known solution through the real
pointer path, and the cascade generator is swept across draws and tiers with
every emitted board checked for structure and solved from its carved solution.

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
  game.ts             The RefractState contract, the game instance, the game
                      mode, and the one-level game definition
  controller.ts       The player controller: the one seat actions and pointer
                      samples are read from, per frame
  board.ts            Cell geometry, the board notation, pointer targeting
  rules.ts            The ruleset: limits R1–R5, completion R6–R9
  tracing.ts          The per-sample press/move/release resolution: the grab
                      table, extending, retracting, solving mid-trace, clearing
  flow.ts             Every screen transition, written onto the live state and
                      shared by the menus and the debug surface
  campaign.ts         The 24 hand-built boards, transcribed from the case
  cascade.ts          The tier ladder and the solvable-by-construction
                      board generator
  rng.ts              The build's private random source
  input.ts            The registered actions and the layout check
  audio.ts            The five engine cues, played once per event per batch
  debug.ts            The debug surface: poses and readings over the live world
  diagnostics.ts      The values the engine's overlay shows
  render.ts           All canvas drawing, in world units on the stage
  bench.ts            The one actor and the two DrawComponents that render
  harness.ts          The in-process engine harness the build's tests run on
  *.test.ts           The build's own tests, beside the code they cover
```
