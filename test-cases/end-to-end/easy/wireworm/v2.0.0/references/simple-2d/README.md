# Wireworm — `simple-2d` reference implementation

The authored, **correct** reference build of the Wireworm end-to-end test case,
on the [Simple 2D](../../../../../../../packages/simple-2d) engine. It is the
answer a run on `simple-2d` is compared against. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` implemented, the
game split across new modules beside it, and its own tests written alongside, so
what is here is exactly what a run on this engine is asked to produce.

---

**Wireworm** is a fixed-shooter arcade game played on a circuit board. A
segmented data-worm winds down a `40 x 20` grid of capacitor nodes; the player is
a defrag cursor pinned to a shallow band along the floor, firing upward to cut
the worm apart before it reaches the band.

Its defining idea is the **charged field**. Every node the worm is turned by
gains a charge, so the collision that steers the worm also arms the terrain it
steers on. Shoot a node at full charge and it detonates, arcing through the whole
connected cluster of charged nodes around it, clearing them and frying every worm
segment caught in the blast. Every segment a bolt cuts leaves a fresh node
behind, so the field thickens as the fight goes on — and a critical node the worm
reaches sends it diving straight down its column at the band.

Three support foes work the board alongside it: the **glitch** skitters through
the lower board eating nodes, the **dropper** falls down a column reseeding the
field beneath it, and the **corruptor** crawls the upper board slamming nodes
straight to critical. A run is twelve levels on one board, three lives, and a
worm that lengthens and quickens at every level.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## The look

The cold, near-black circuit substrate, its trace grid, the lit rail along the
player band and the mint-and-cyan chrome are this build's own. The specification
fixes the rules and the geometry and deliberately leaves the palette, the type
and the layout to the build, stating only what a player has to read at a glance:
the four charge states as a ramp, the worm apart from the field, the cursor
apart from its band, the three foes apart from one another. So the look lives in
`src/theme.ts` rather than beside the case-fixed figures in `src/constants.ts`,
which carries no color and no typeface at all.

The nodes, the worm, the cursor and the three foes are drawn from the **seeded
sprite art** under `assets/`, loaded through the engine's asset loader under the
fixed `assets/` root. Everything else — the board, the band, a bolt, a discharge
arc, the HUD, every screen — is drawn in code.

## Controls

Every keyboard control is a **registered engine action** on the
`dpad-4-two-buttons` touch layout:

| Action                           | Keys               | Does                                                            |
| -------------------------------- | ------------------ | --------------------------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Moves the cursor inside its band; moves a menu highlight.       |
| `a` / `b`                        | `Space`            | Fires a bolt, every `0.15` s while held, up to three in flight. |
| `confirm`                        | `Enter` or `Space` | Takes the highlighted menu item.                                |
| `back`                           | `Esc`              | Leaves the current screen.                                      |
| `pause`                          | `P` or `Esc`       | Pauses live play.                                               |
| `mute`                           | `M`                | Toggles sound, on any screen.                                   |

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen and phase, the score, lives and level, how many nodes stand, each
worm's id, length, head tile, headings and diving flag, each foe's id, kind and
position, the cursor, and how many bolts are in flight. That key belongs to the
engine, not to this game.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in
seconds, the state held by value and handed out `DeepReadonly`, the canvas fit
(uniform scale, centered letterbox, device pixel ratio), named keyboard actions
with edge detection, audio cue synthesis with mute and the first-gesture unlock,
asset loading under the fixed `assets/` root, and the debug overlay. What is left
is the game: the field, the worm, the discharge, the foes, the run, the drawing,
and the state the debug surface poses.

## The state is a value

Every field of `WirewormState` is `readonly` and every array a `readonly` array,
so the declared type and the `DeepReadonly` view the engine hands out are the
same shape, and nothing in this build writes to a state it was handed. What a
frame does instead is copy the state into `Sim` — a field-for-field mutable
mirror in `src/sim.ts` — advance that, and return it, which keeps each rule
readable as the rule while the immutability the engine requires is enforced at
the one boundary where it matters. There is no module-level game state and no
closure over mutable data; `render` and every diagnostic source are reads of the
state they are given, and the compiler is what says they cannot change it.

**The worm is clocked; everything else is a rate.** Each worm carries its own
step accumulator and takes one tile step for each interval that accumulates,
carrying the remainder, so a frame covering several intervals runs several steps
in order. The cursor, the bolts, the foes, the arcs and the phase timers are all
per-second rates integrated against `dt`.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: `src/debug.ts` builds it, `initialize` returns it
beside the state as `[state, createDebugApi()]`, and a caller reads that same
object back off **`engine.debug`**. Nothing is published on the page.

Every operation is a pose or a reading over `WirewormState`, written in the shape
of `update`, and each pose sets one field and takes scalars:

```ts
engine.apply((s) => engine.debug.setNode(s, 10, 10, 3));
engine.apply((s) => engine.debug.addWorm(s, 10, 11));
engine.apply((s) => engine.debug.addBolt(s, 336, 528));
await engine.advance(20);
const { nodes, worms, arcs, score } = engine.debug.snapshot(engine.state);
```

Beside the core (`reset`, seedable, and `snapshot`) it carries the screen and run
poses, the three **world gates** — `setFoeSpawning`, `setWormEntry` and
`setCursorContact`, each gating one faculty of the level itself so a posed
scenario is not invaded by entities its requirement never asked for — the cursor
and bolt operations, the node-field operations, the per-worm and per-foe
operations with their two faculty gates each, and the four `clear*` operations,
one per roster. Everything about _driving a browser game_ — the clock, exact
frames, key events, the overlay, the mute bit — is the engine's, which is why the
surface carries no `advance`, no `keyDown` and no `setMuted`. It is inert during
normal play.

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

The engine, `@test-cabinet/simple-2d`, is a relative `file:` dependency on the
repository's `packages/simple-2d`, which npm installs as a symlink, so this
project builds and tests against the engine's current source. A run receives the
same package at `.tcab/engine/@test-cabinet/simple-2d/` instead, so the import in
the sources is the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`), and serves the `assets/` tree from the project root.

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root and the sprite art under `dist/assets/`. Serve that
directory as-is from any static file server, at any base path:

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

`npm test` runs the build's own suite **in process**: it stands a real engine up
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`engine.advance` against a `ConstantClock`, drives the keyboard by dispatching
events at the surface's event target, poses scenarios through `engine.apply`, and
reads results back from the state, the debug surface, the engine's cue events and
the pixels the render produced. No browser is involved. One file
(`src/sprites.test.ts`) additionally stands `fetch` and `createImageBitmap` up
over the project's own `assets/` directory, so the seeded frames are loaded and
drawn for real.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded sprite art, six folders of 32x32 frames
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: palette and type
  game.ts             The WirewormState contract, BACKGROUND, and the three
                      functions the engine drives
  sim.ts              The mutable mirror a frame is built in, and FrameEvents
  field.ts            The node field: charge, the tile map, the starting scatter
  worm.ts             Entry, the step, and the runs a cut worm falls into
  discharge.ts        The chain, what it fries, and the arcs it reports
  bolts.ts            Firing, swept flight, and what a bolt resolves against
  foes.ts             The three foes' motion, their effect, and their spawners
  cursor.ts           The band clamp, the movement rate, and contact
  scoring.ts          Every figure paid, and the bonus life it earns
  flow.ts             The opening state, reset, the run, the life, the level
  simulate.ts         One frame, from the top: the order the rules run in
  assets.ts           Loading the seeded frames through the engine's loader
  input.ts            The registered actions and this frame's reads
  audio.ts            The ten engine cues
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The debug surface: poses and readings over WirewormState
  render.ts           All canvas drawing, in logical space
  *.test.ts           The build's own tests, beside the code they cover
```
