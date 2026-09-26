# Wireworm — `structured-2d` reference implementation

The authored, **correct** reference build of the Wireworm end-to-end test case,
on the [Structured 2D](../../../../../../../packages/structured-2d) engine. It
is the answer a run on `structured-2d` is compared against. It is **never seeded
into a run** — handing a model the finished game would defeat the test — and
takes no part in the case's seed set. The case specs under `../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` written, the game
split across new modules beside it, and its own tests written alongside, so what
is here is exactly what a run on this engine is asked to produce.

---

**Wireworm** is a fixed-shooter arcade game played on a circuit board. A
segmented **data-worm** winds down a `40 x 20` grid of tiles through a field of
capacitor **nodes**. The player is a defrag **cursor** pinned to a shallow band
along the floor, firing bolts straight up to cut the worm apart before it reaches
the band.

Wireworm's defining idea is the **charged field**. Every node the worm is turned
by gains a charge, so the collision that steers the worm also arms the terrain it
steers on. A node at the critical charge **detonates** when it is shot: the
discharge chains through every charged node within two tiles of a node it
detonated, clearing the whole connected cluster and frying every worm segment
caught in it. Every segment cut by a bolt leaves a fresh inert node behind, so
the field thickens as the fight goes on — and a critical node the worm reaches
sends it **diving** straight down its column.

Three support foes work the board alongside the worm: the **glitch** skitters
down and eats the field, the **dropper** falls and reseeds it, and the
**corruptor** crawls the upper board slamming what it crosses straight to
critical. A run is twelve levels on one board, three lives, and a field that
persists across both.

The look — a near-black substrate under etched traces, a lit floor band, and a
charge ramp carried in light as well as in the sprite — is this build's own. The
specification fixes the rules, the geometry and the figures and deliberately
leaves the palette, the type and the layout to the build, so the look lives in
`src/theme.ts` rather than beside the case-fixed figures in `src/constants.ts`.
The nodes, the worm, the cursor and the three foes are drawn from the sprite art
seeded under `assets/`.

This is a self-contained static web app — plain **TypeScript** inside the
engine's gameplay framework, drawing to an **HTML5 canvas**, bundled with
**Vite**. No backend, accounts, network calls, or API keys; everything needed to
play is in the built bundle.

## Controls

Every control is a **registered engine action** on the `dpad-4-two-buttons`
touch layout:

| Action                           | Keys               | Does                                                            |
| -------------------------------- | ------------------ | --------------------------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Moves the cursor inside its band; moves a menu highlight.       |
| `a` / `b`                        | `Space`            | Fires a bolt, every `0.15` s while held, up to three in flight. |
| `confirm`                        | `Enter` or `Space` | Accepts the highlighted menu item.                              |
| `back`                           | `Esc`              | Leaves the current screen.                                      |
| `pause`                          | `P` or `Esc`       | Pauses live play, opening the pause menu.                       |
| `mute`                           | `M`                | Toggles sound, on any screen.                                   |

`Space` and `Esc` each drive two actions, and the screen decides which applies:
`Space` fires while the game is being played and confirms on a menu, `Esc` pauses
while it is being played and goes back otherwise.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows the
screen and phase, the score, lives and level, the nodes standing, each worm's id,
length, head tile, headings and dive, each foe's id, kind and position, the
cursor, and the bolts in flight. That key belongs to the engine, not to this
game.

## What the engine owns

`@clockwyrks/structured-2d` is a gameplay framework as much as a runtime, and
none of what it owns is written here: the frame loop and its replaceable clock,
the construction and ticking of the framework objects in a fixed order, the
rendering pipeline and the camera, the canvas fit (uniform scale, centered
letterbox, device pixel ratio), asset loading under the fixed `assets/` root,
named keyboard actions read through a player controller with consume-on-read
edges, audio cue synthesis with mute and the first-gesture unlock, and the debug
overlay. What is left is the game: the rules, the drawing, and the state the
debug surface poses.

## One world, one live state

The game is a single `GameDefinition` with a single level, opened once and never
left: every screen is a value of `state.screen`, so the node field survives a
level advance without being rebuilt. `WirewormMode` names `WirewormState` — the
class `specs/state.md` declares — as its `gameStateClass`, so `engine.world.state`
is the one live instance and the whole of the authoritative game. The player
controller resolves each frame's actions straight onto it, the mode's tick
advances the simulation, and the debug surface's poses arrange it at the call.
Nothing lives in a module-level variable or a closure; the actor, its components
and the controller hold no authoritative state of their own.

The mode's `beginPlay` adds **one player possessing nothing** — the cursor is a
figure in the state rather than a pawn — and that player's controller,
`WirewormController`, is the one place input is read. The camera is left at rest,
so world units and the stage's `1280 x 720` logical units coincide; the level's
one actor, the `Board`, carries eight `DrawComponent`s — ground, nodes, worms,
foes, bolts, cursor, arcs, UI — whose draws are pure reads of the state through
`src/render.ts`.

Two details are worth naming because they are where this game meets the
framework:

- **The worm is the one clocked thing.** Every other rate is per second and
  integrated against the frame's delta; a worm accumulates that same delta in its
  own `stepClock` and takes one tile step each time the clock reaches
  `wormStepInterval(level)`, taking the interval off the clock rather than
  zeroing it, so a frame covering several intervals runs several steps in order.
- **`phase` is Wireworm's, not the match's.** The engine's `GameState` carries a
  match `phase` (`waiting`/`playing`/`over`); `specs/state.md` declares Wireworm's
  `phase` as the sub-phase of the `playing` screen (`banner`/`active`/`respawn`).
  The mode never calls `setPhase`, so the two vocabularies never meet;
  `src/game.ts` says how the declaration is made.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: the instance's `initialize` returns it, the engine
holds it, and a caller reads that same object back off **`engine.debug`**. Nothing
is published on the page.

Every operation acts on the live world at the moment it is called, and every pose
sets one field:

```ts
engine.debug.setScreen("playing");
engine.debug.setPhase("active");
engine.debug.setNode(10, 8, 3);
engine.debug.addWorm(9, 8);
engine.debug.addBolt(336, 400);
await engine.advance(6);
const { nodes, arcs, worms } = engine.debug.snapshot();
```

The operations are `reset` (seedable) and `snapshot`; the screen and run poses;
the three **world gates** `setFoeSpawning`, `setWormEntry` and
`setCursorContact`, each holding one faculty of the level itself so a scenario
can pose a board holding only what its requirement concerns; the cursor and bolt
poses; the node-field poses; the worm poses, which build a worm one segment at a
time and gate its step and its body separately; and the foe poses, which gate a
foe's mind and its travel separately. There is no operation that fires and none
that mutes: a caller that wants a bolt places one, and mute is reached through
its real binding. The surface is inert during normal play.

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
this project builds and tests against the engine's current source. A run receives
the same package at `.vendor/engine/@clockwyrks/structured-2d/` instead, so the
import in the sources is the same either way.

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload at the URL it prints (default
`http://localhost:5173`). The dev server serves the sprite art under `assets/`
from the project root, which is the root the engine's loader resolves against.

## Production build

```sh
npm run build
```

This type-checks the sources and emits a complete static site into **`dist/`**,
with `index.html` at its root and the sprite art at `dist/assets/`. Serve that
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
events at the surface's event target, poses scenarios through the debug surface
at `engine.debug`, and reads results back from the world's state, the surface's
snapshot, the engine's cue events, and the pixels the render produced. Node has
neither `createImageBitmap` nor a `fetch` that resolves a relative path, so the
harness stands both up over this project's own `assets/` directory and a headless
run draws the same picture a browser does. No browser is involved.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/, copies assets/ into it)
vitest.config.ts      The build's own test suite, over src/
assets/               The seeded sprite art: six folders of 32x32 frames
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: layers, palette, type
  game.ts             The WirewormState contract, the game instance, the game
                      mode, and the one-level game definition
  controller.ts       The player controller: the one seat actions are read
                      from, per frame
  sim.ts              What one frame owes the game, in the order the rules
                      compose in
  grid.ts             What stands on a tile, and the inverse of the tile map
  worm.ts             Entry, the step clock, winding, diving, and cutting
  discharge.ts        The chain, what it fries, and the arcs it reports
  bolts.ts            A bolt's flight and what it resolves against
  foes.ts             The three foes: travel, effect, and the level's spawners
  cursor.ts           Movement in the band, firing, and the contact test
  flow.ts             The run: starting one, losing a life, clearing a level
  scoring.ts          Every figure the run is paid, and the bonus life
  rng.ts              The game's private random source
  input.ts            The registered actions and the layout check
  audio.ts            The ten engine cues, played once per event per frame
  debug.ts            The debug surface: poses and readings over the live world
  diagnostics.ts      The values the engine's overlay shows
  sprites.ts          The seeded art, loaded through the engine's loader
  render.ts           All canvas drawing, in world units on the stage
  stage.ts            The one actor and the eight DrawComponents that render
  harness.ts          The in-process engine harness the build's tests run on
  *.test.ts           The build's own tests, beside the code they cover
```
