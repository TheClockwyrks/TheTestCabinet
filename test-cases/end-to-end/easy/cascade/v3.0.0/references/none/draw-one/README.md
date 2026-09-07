# Cascade — `none` reference implementation (`draw-one`)

The authored, **correct** reference build of the Cascade end-to-end test case's
**Draw One** variant on **no engine**. It is **never seeded into a run** —
handing a model the finished game would defeat the test — and takes no part in
the case's seed set. The case specs under `../../../specs/` remain authoritative
for the design.

The project is the case's seeded engineless workspace (`../../../workspaces/none/`)
— configuration files and nothing else — with the whole of `src/` written: the
runtime the game stands on, the game, and the tests for both. What is here is
exactly what a run on no engine is asked to produce.

---

**Cascade** is a single-player patience game for the browser: a Klondike
solitaire played on a green felt table. Twenty-eight cards are dealt into seven
tableau columns, and the player builds four foundations up from Ace to King, one
suit each, by moving cards between the columns, turning cards off the stock, and
freeing the buried cards underneath.

Cascade's defining idea is its ending. The moment the fifty-second card reaches a
foundation the table gives way: every card on the foundations launches off in
turn, arcs under gravity, bounces along the floor, and **paints itself onto the
table as it goes**, until the felt is buried under overlapping cards and the last
flyer has drifted off a side edge.

This build plays **Draw One**: a turn of the stock moves exactly one card onto
the waste, so every card in the stock is reachable and the game is markedly more
winnable than the Draw Three deal.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine and no runtime
dependency at all. No backend, accounts, network calls, or API keys; everything
needed to play is in the built bundle, and every card, the table, the HUD and
every screen is drawn in code with no art or audio files at all.

The look is this build's own. The specs fix what must be legible — a card's rank
and suit, red told from black, a back told from a face and both from the felt, an
empty slot told from the bare table, a run in hand reading as lifted, a
highlighted target reading as highlighted — and leave the palette, the type and
the rendering to the build. This build chose flat green felt, ivory faces with a
single large pip, and a blue lattice back. Those choices live in `src/theme.ts`,
apart from the figures the specs fix in `src/constants.ts`.

## Playing

The **pointer** plays the whole game, and a mouse and a touchscreen stand on the
same footing: a click is a tap and a drag is a touch drag.

| Gesture                                 | Does                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Press a face-up column card             | Lifts that card and every card below it, on the press itself.          |
| Press the waste's or a foundation's top | Lifts that card alone.                                                 |
| Drag and release over a pile            | Drops the run there when the pile accepts it, and returns it when not. |
| Click (a release within 5 units)        | Returns a held run, and answers whatever control the press landed in.  |
| Click the stock                         | Turns one card onto the waste; clicking the empty stock recycles.      |
| Double-click a playable card            | Sends it to the foundation it belongs on.                              |
| Press anywhere on the won screen        | Deals a fresh game.                                                    |

Three controls sit in the HUD along the bottom during play — `NEW GAME`, `MENU`
and `SOUND` — beside the `DRAW ONE` deal-mode label. The title screen carries
`NEW GAME` and `HOW TO PLAY`; the how-to screen carries `BACK`.

The **backtick** key (`` ` ``) toggles the read-only diagnostics overlay. That
key belongs to the runtime (`src/overlay.ts`), not to the game.

Ten audio cues — deal, turn, recycle, lift, drop, reject, flip, home, launch and
win — are synthesized on the spot, unlocked by the first gesture, and told apart
by ear. The HUD's `SOUND` control silences them all.

## The runtime this project carries

Cascade runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game — there is no
asset loader, because Cascade loads nothing — and it is five files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform, and calls `update` then `render`.
  There is no fixed timestep and no accumulator, so the simulation reads nothing
  from the renderer. It also owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centred letterbox,
  and the device pixel ratio, re-derived at the top of every frame so no resize
  handler is needed — plus the inverse map that puts the pointer in logical stage
  units. `src/render.ts` draws in logical `1280x720` coordinates and never reads
  the canvas element's size.
- **`src/pointer.ts`** — the pointer read off the page: every press, move and
  release mapped into stage units and buffered in arrival order, so a press and
  the release that followed it inside one frame both take effect.
- **`src/audio-bus.ts`** — cues declared by name and synthesized as one
  oscillator through one gain envelope, over a Web Audio context opened on the
  first user gesture. Nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the drawing in device space over
  the finished frame, and its read-only-ness. The game only names the values it
  shows, in `src/diagnostics.ts`.

`src/keyboard.ts` is the one key this game listens for, and `src/main.ts` is the
whole of the wiring between that layer and the game.

## The game

- **`src/constants.ts`** — every figure the specification fixes, named once.
- **`src/table.ts`** — the table's geometry: the anchors, the column fan and its
  compression, and the thirteen drop rectangles.
- **`src/rules.ts`** — what a foundation and a column accept.
- **`src/board.ts`** — the thirteen piles, the deal, the stock and the waste's
  set memory, and every move over them.
- **`src/controls.ts`** — one pointer sample resolved: the grab, the click, the
  drop and the double click.
- **`src/cascade.ts`** — the victory cascade: the launch clock, the integration,
  the floor bounce and the painted layer's stamps.
- **`src/render.ts`**, **`src/cards.ts`**, **`src/theme.ts`** — the drawing.
- **`src/state.ts`**, **`src/game.ts`** — the state and the order a frame does
  things in.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__cascade`**, so a scenario can be posed on Cascade's own table from
code:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the game from the wall clock, and `advance` runs that
  many whole frames — the same update the loop runs, then a render — covering
  that much game time.
- `reset()` and `snapshot()` — return every declared field to its title-screen
  value (`muted` deliberately kept) and read a JSON-serializable view of the
  whole state.
- `setScreen`, `addCard`, `removeCard`, `setCardFaceUp`, `clearPile`,
  `clearTable`, `addWasteSet`, `clearWasteSets`, `addFlyer`, `setFlyerPosition`,
  `setFlyerVelocity`, `removeFlyer`, `clearFlyers`, `setLaunchClock` and
  `clearTrail` — **poses**, each setting one field of the state and nothing else,
  so a table is built one card at a time.
- `drawLaunchVx` — the launch's own `vx` draw performed alone, returning the
  signed value it drew and touching no field.
- `setAutoFlip`, `setWinDetect`, `setLaunching` and `setTrailPainting` — the four
  **faculty gates**, each gating one faculty, each on by default and restored by
  `reset`, each reported by the snapshot.
- `deal`, `turnStock`, `move` and `autoMove` — the **game's own events**, routed
  through exactly the code a player's gesture routes through, reporting only what
  the game's own rules decided.
- `pointerDown(x, y)`, `pointerMove(x, y)` and `pointerUp(x, y)` — the same input
  path the runtime's pointer feeds, each resolved the moment it is called, so a
  whole gesture drives from code with no frame between the calls.

There is deliberately no `setMuted` (mute is reached through the HUD's `SOUND`
control, and the snapshot reports the result), no menu operation (Cascade's menus
carry no selection; a validator presses a control's rectangle), and no overlay
toggle (the runtime owns the backtick key).

The surface is inert during normal play. The deal's shuffle and the cascade's
launch velocities are drawn from a random source private to `src/rng.ts`.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed.

## Install

```sh
npm ci
```

This project depends on no runtime package at all: everything it runs on is in
`src/`, so `npm ci` installs the TypeScript toolchain and nothing else.

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
server, at the root or at a sub-path:

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

`npm test` runs the build's own suite **in process**, with no browser involved.
The runtime's own modules are checked directly, over an event target and a
`Surface` of the test's own; the game is checked by posing tables and driving
the real pointer path, and the drawing is checked by rendering onto an
`@napi-rs/canvas` context and reading the pixels and the runs of text back.
