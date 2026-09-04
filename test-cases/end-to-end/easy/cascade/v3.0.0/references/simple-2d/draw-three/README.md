# Cascade — `simple-2d` reference implementation, Draw Three

The authored, **correct** reference build of the Cascade end-to-end test case's
**draw-three** variant, on the
[Simple 2D](../../../../../../../../packages/simple-2d) engine. It is the answer
a run on this engine and this variant is compared against. It is **never seeded
into a run** — handing a model the finished game would defeat the test — and
takes no part in the case's seed set. The case specs under `../../../specs/`
remain authoritative for the design.

The project is the case's seeded workspace at
`../../../workspaces/draw-three/simple-2d` with `src/game.ts` implemented, the
game split across new modules beside it, and its own tests written alongside, so
what is here is exactly what a run on this engine is asked to produce.

---

**Cascade** is a Klondike solitaire, played in the browser on a felt table.
Twenty-eight cards are dealt into seven columns and the player builds four
foundations up from Ace to King, one suit each, by moving cards between the
columns, turning cards off the stock, and freeing the buried cards underneath. In
this variant a turn of the stock moves **three** cards at once, fanned to the
right, and only the front one is in play.

Cascade's defining idea is its ending. The moment the fifty-second card reaches a
foundation the table gives way: every card on the foundations launches off in
turn, arcs under gravity, bounces along the floor, and paints itself onto the
table as it goes, until the felt is buried under overlapping cards and the last
flyer has drifted off a side edge.

The felt-and-paper look — a bright billiard green, cream card faces with drawn
pips, a blue lattice back, gold for the run in hand and for the pile it would
land on — is this build's own: the specification fixes the rules and the geometry
and deliberately leaves the palette, the type, and the artwork to the build, so
the look lives in `src/theme.ts` and `src/card-art.ts` rather than beside the
case-fixed figures in `src/constants.ts`.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. There is no art or audio
file anywhere in it: every card, every screen and every sound is made in code. No
backend, accounts, network calls, or API keys; everything needed to play is in
the built bundle.

## The deal mode

| Figure            | Value        |
| ----------------- | ------------ |
| `TURN_COUNT`      | `3`          |
| `DEAL_MODE`       | `draw-three` |
| `DEAL_MODE_LABEL` | `DRAW THREE` |

Each turn puts its three cards on the waste as one **set**, and the waste
remembers its sets in the order they were turned. It shows the cards still on the
newest set that holds any, and once a set has been played off entirely it falls
back to what is left of the set turned before it. So the fan counts three, two,
one and then drops back to the earlier turn's remainder — it is never refilled
from the cards buried behind it. Recycling the stock empties the waste and its
set memory together.

## Controls

Cascade is played entirely with the pointer, and a mouse and a touchscreen stand
on the same footing. The build registers no engine actions and passes no touch
layout: every control is a rectangle a press lands in.

| Gesture                                 | Does                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Press a face-up column card             | Lifts it and every card below it, as a run, on the press itself                 |
| Press the front card of the waste's fan | Lifts that card alone                                                           |
| Press a foundation's top card           | Lifts that card, to be played back onto a column                                |
| Drag and release over a pile            | Lands the run where the leading card's centre lies, or returns it               |
| Click the stock                         | Turns three cards onto the waste, or recycles the waste once the stock is empty |
| Double-click a playable card            | Sends it straight to the foundation it belongs on                               |
| Click `NEW GAME`, `MENU` or `SOUND`     | Deals afresh, returns to the title, or toggles the sound                        |
| Press anywhere on the won screen        | Deals a fresh game, which clears the painted table                              |

A release within five units of its press is a **click** rather than a drop: it
returns anything in hand, activates whatever control the press landed in, and is
the press-and-release the double click pairs.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows the
screen and the deal mode, the size of every pile, whether a run is in hand and how
big it is, and, during a cascade, how many cards have launched and how many are in
flight. That key belongs to the engine, not to this game.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in
seconds, the state held by value and handed out `DeepReadonly`, the canvas fit
(uniform scale, centred letterbox, device pixel ratio), **the pointer** —
position already in logical stage units, and the ordered per-frame sample list a
gesture arrives as — audio cue synthesis with mute and the first-gesture unlock,
and the debug overlay. What is left is the game: the deal, the rules over the
thirteen piles, the gestures that drive them, the victory cascade, the drawing,
and the state the debug surface poses.

The one thing the engine cannot supply is the cascade's **painted layer**. The
engine clears the canvas before every frame, so the trail is an offscreen surface
of the build's own (`src/trail.ts`), stamped once a frame per card in flight and
blitted beneath everything the table draws. It is a drawing resource rather than
part of the game: what the cascade painted is reported by `trailStamps`, which is
a declared field of the state.

## The state is a value

Nothing in this build writes to a state it was handed. Every field of
`CascadeState` is `readonly` and every array a `readonly` array, so the declared
type and the `DeepReadonly` view the engine hands out are the same shape. What
`update` and every debug pose do instead is copy the state into a `Sim` — the
same record with the `readonly` markers dropped (`src/sim.ts`) — advance that,
and return it, so a rule reads as the sentence its spec writes while the
immutability the engine requires is enforced at the one boundary that matters.
There is no module-level game state and no closure over mutable data, which is
what makes `reset` enough to replay a scenario exactly.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: `src/debug.ts` builds it, `initialize` returns it
beside the state as `[state, createDebugApi()]`, and a caller reads that same
object back off **`engine.debug`**. Nothing is published on the page.

Every operation is a pose or a reading over `CascadeState`, written in the shape
of `update`:

```ts
engine.apply((s) => engine.debug.clearTable(s));
engine.apply((s) => engine.debug.addCard(s, "tableau", 0, "spades", 1, true));
const { tableau } = engine.debug.snapshot(engine.state);
```

`move` and `autoMove` are the exception: each applies the game's own rules and
then reports what those rules decided, so each returns `[nextState, verdict]` and
the pair is split **inside** the transition rather than outside it:

```ts
let sentHome = false;
engine.apply((s) => {
  const [next, verdict] = engine.debug.autoMove(s, "waste", 0);
  sentHome = verdict;
  return next;
});
```

The surface builds a table one card at a time — `addCard`, `removeCard`,
`setCardFaceUp`, `clearPile`, `clearTable`, `addWasteSet`, `clearWasteSets` — and
then lets the game's own rules run from there: `deal`, `turnStock`, `move`,
`autoMove`, and the immediate-effect pointer trio `pointerDown` / `pointerMove` /
`pointerUp`. The pointer operations do not stand in for the engine's pointer;
they feed the **same resolution path** its samples feed, so the hit test, the grab
rule, the drop rule and the double-click rule all run exactly as they do for a
player. Four faculty gates — `setAutoFlip`, `setWinDetect`, `setLaunching`,
`setTrailPainting` — each hold one faculty still and nothing else, and every one
of them is reported by `snapshot`. Everything about _driving a browser game_ is
the engine's, which is why the surface carries no clock operation, no overlay
toggle and no `setMuted`. It is inert during normal play.

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

`npm test` runs the build's own suite **in process**: it stands a real engine up
over an `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, steps it with
`engine.advance` against a `ConstantClock`, drives the pointer by dispatching
pointer-shaped events at the surface's event target, poses scenarios through
`engine.apply`, and reads results back from the state, the debug surface, the
engine's cue events, the strings the render drew, and the pixels it produced. No
browser is involved. Among the suite: a whole victory cascade is run out from a
real win, fifty-two launches and all, and the waste's set memory is driven
through turn, turn, play, turn, play-all and read back.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (emits to dist/)
vitest.config.ts      The build's own test suite, over src/
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  theme.ts            This build's own look: the palette and the type
  game.ts             The CascadeState contract and the three functions the
                      engine drives; the per-frame cue and mute wiring
  sim.ts              The working value a frame is built in, and its accessors
  cards.ts            The deck, and what a foundation and a column accept
  layout.ts           Where every card is drawn, and the drop rectangles;
                      the one answer both the picture and the pointer read
  table.ts            The deal, the stock and the waste, and every move
  pointer.ts          Press, move and release: the grab, the click, the drop,
                      and the double click
  cascade.ts          The victory cascade: the flight, the bounce, the cadence
  trail.ts            The persistent surface the cascade paints onto
  flow.ts             The opening state and what `reset` restores
  simulate.ts         One frame: the samples, then the clock, then the cascade
  rng.ts              The seeded generator: a draw beside the next state
  audio.ts            The ten engine cues, played once per event per frame
  debug.ts            The debug surface: poses and readings over CascadeState
  diagnostics.ts      The values the engine's overlay shows
  card-art.ts         How a card, a back and an empty slot are drawn
  render.ts           All canvas drawing, in logical space
  *.test.ts           The build's own tests, beside the code they cover
```
