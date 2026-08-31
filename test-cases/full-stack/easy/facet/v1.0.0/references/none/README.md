# Facet — `none` reference implementation

The authored, **correct** reference build of the Facet full-stack test case on
**no engine**. It is **never seeded into a run** — handing a model the finished
game would defeat the test — and takes no part in the case's seed set. The case
specs under `../../specs/` remain authoritative for the design.

The project is the case's seeded engineless workspace (`../../workspaces/none/`)
— configuration files and nothing else — with the whole of `src/` written and
the produced assets committed under `public/assets/`. What is here is exactly
what a run on no engine is asked to produce.

---

**Facet** is a match game of cut stones, played in the browser on a lapidary's
bench. The board is an eight-by-eight field of gems in seven kinds — ruby,
amber, citrine, jade, beryl, sapphire, amethyst — each with a silhouette and a
facet pattern of its own as well as a hue. Swap a stone with the one beside it,
and any line of three or more of one kind shatters; the stones above fall into
the gap and fresh ones drop in from the top.

Facet's defining idea is **strain**. Every clear presses on the gems around it,
and a gem that has taken enough of that pressure is **flawed**: it shatters with
any clear that touches it and is worth double, so a swap made beside a worn
stretch of the board runs on into a long chain. A line of four leaves a
**brilliant** that takes the ring of stones around it, a line of five or more
leaves a **prism** that — swapped against a stone — takes every stone of that
kind, and a line crossing another leaves a **star** that takes its whole row and
column.

This is a self-contained static web app — plain **TypeScript** drawing to an
**HTML5 canvas**, bundled with **Vite**, standing on no engine. No backend,
accounts, network calls, or API keys; everything needed to play is in the built
bundle.

Unlike an end-to-end case, a full-stack case **produces its own assets**: every
gem, break sheet, particle system, sound, and piece of music under
`public/assets/` was made with the six asset tools during the authoring run and
committed. The build bundles those committed files and **invokes no tool**, so
`npm ci && npm run build` works on a machine that has never seen them. Only the
chrome — the HUD, the level meter, the menus, the cursor, selection and refusal
marks, and the debug overlay — is drawn in code.

The look is this build's own. The specs fix what must be legible — seven kinds
told apart by more than hue, four strain states reading as deepening damage, the
three cuts and the prism reading apart from a plain stone, every form inside
`GEM_R` of its cell center — and leave the palette, the type, and the artwork to
the build. This build chose a bench after dark: a warm near-black ground, brass
and candle-gold chrome, and the produced sprites carrying every hue on the
board. Those choices live in `src/theme.ts`, apart from the figures the specs fix
in `src/constants.ts`.

## Controls

The **pointer plays the board**: press a stone to select it, then press the one
beside it to swap — or drag straight onto its neighbor, which asks for the same
swap without a second press. Pressing the selected stone again clears the
selection; pressing a stone farther off moves the selection there.

The keyboard drives a cursor over the same board, and the menus, as **named
actions** bound to physical keys (`KeyboardEvent.code`), so the bindings survive
a non-QWERTY layout:

| Action                           | Keys               | Does                                                      |
| -------------------------------- | ------------------ | --------------------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Move the board cursor; `up`/`down` move a menu highlight. |
| `confirm`                        | `Enter` or `Space` | Selects the cursor's cell, or swaps with it.              |
| `pause`                          | `P`                | Enters and leaves the pause screen.                       |
| `mute`                           | `M`                | Toggles sound, on any screen.                             |
| `back`                           | `Esc`              | Leaves how-to, the pause screen, and the end of a round.  |

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

Eight audio cues — select, swap, refuse, clear, flaw, cut, level-up, game-over —
are produced `.wav` files played over Web Audio, unlocked by the first gesture.
`clear` sounds the **chain ladder**: the shatter body under one of eight
ascending tones, the rung chosen by the step's multiplier, so a long chain climbs
and holds at the top.

## The produced assets

Everything under `public/assets/` was made with the six tools on the authoring
machine's `PATH` and is loaded page-relative at runtime, so the built site works
mounted under a sub-path.

| Directory              | What it holds                                                               | Tool                      |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------- |
| `gems/*.png`           | The seven kinds and the prism at each of four strain states; the two cut    | `draw`                    |
|                        | overlays; the board frame (648 x 648, the bench the field sits on)          |                           |
| `gems/break/<kind>/`   | A six-frame shatter for each kind, played at the cell a step clears         | `draw-sheet`              |
| `gems/prism-turn/`     | The prism's eight-frame idle turn, looped for a clean prism on the board    | `draw-sheet`              |
| `fx/*.system.json`     | The clear burst, the flawed detonation, and the cut flash, simulated live   | `particle-2d`             |
| `audio/*.wav`          | The seven synthesized cues, the eight ladder rungs, and the sampled shatter | `sfx-synth`, `sfx-sample` |
| `audio/{title,play}.*` | The title theme and the play bed, each a `.wav` beside its `.mid` score     | `music`                   |

The three particle systems are played through
`@test-cabinet/particle-runtime`'s `ParticleCanvasPlayer` — the only runtime
dependency this build has — each burst simulated into a scratch canvas of its
system's own field size and blitted, additively, at the cell it belongs to.

## The runtime this project carries

Facet runs on no engine, so the layer every browser game needs is part of the
build. It is sized for this game rather than for every 2D game, and it is seven
files:

- **`src/runtime.ts`** — the frame loop and the wiring. It measures each frame's
  delta in **seconds** (clamping the gap a backgrounded tab resumes with), clears
  the canvas, installs the logical transform and nearest-neighbor sampling, and
  calls `update` then `render` — the state a **value**: `update` returns the next
  state and the runtime stores it. There is no fixed timestep and no accumulator,
  so the same second of play reaches the same state however it was divided into
  frames. It also owns the **manual clock** (below).
- **`src/viewport.ts`** — the canvas fit: one uniform scale, a centered
  letterbox, and the device pixel ratio, re-derived at the top of every frame so
  no resize handler is needed — plus the inverse map that puts the pointer in
  logical stage units, which is what lets the game hit-test a cell center with no
  conversion of its own.
- **`src/keyboard.ts`** — named actions over `KeyboardEvent.code` bindings, with
  edge detection: an edge is armed when an action leaves rest, consumed by the
  first reader, and discarded at the end of its frame.
- **`src/pointer.ts`** — the pointer read off the page: every press, move, and
  release mapped into stage units and buffered in arrival order, so a drag that
  crossed a cell boundary between two frames is resolved at the cell it crossed.
- **`src/assets.ts`** — the manifest of every produced file and the loader that
  fetches it. Loading runs in the background from the first frame, so the game
  and `window.__facet` are up immediately and each sprite joins the picture on
  the frame after it lands.
- **`src/audio-bus.ts`** — cues declared by name over the produced `.wav`s,
  decoded once through `decodeAudioData` on a Web Audio context opened by the
  first user gesture, plus the looping music bed. Muting is a gain of zero on the
  master, not a skipped cue, and nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## The core, and what sits on it

`src/core/` is Facet's whole simulation — the board and its notation, the seeded
generator, R1 to R9, the chain cadence, the screens and their menus, the opening
deal, and the pose logic behind the debug surface. It imports **nothing** but
`src/constants.ts`: no engine, no renderer, no DOM. It is the same core the case's
`simple-2d` and `structured-2d` reference builds carry, written once.

`src/game.ts` is the bridge. It reads the frame's input, hands the core the
frame's delta time, plays the cues the frame raised, and keeps the pointer and
mute mirrors honest. The one thing it adds is the link to the **presentation**
(`src/effects.ts`): the core reports _that_ a step cleared something, and the
shatter sheets and particle bursts need to know _which_ cells, so `reportFor`
re-derives it from the core's own R5, R6, and R8 over the board that step read.
None of that decoration is part of the state, because
`specs/instrumentation.md` rests on the state being reproducible from a seed and
a delta time.

## Debugging and automation

The build exposes the surface `specs/instrumentation.md` specifies on
**`window.__facet`**, so a scenario can be posed in Facet's own world from code:

- `setAutoStep(enabled)` and `advance(seconds, frames)` — the **clock**. Nothing
  outside this build owns it, so the surface carries it: `setAutoStep(false)`
  stops the loop advancing the simulation from the wall clock, and
  `advance(seconds, frames)` runs that many whole frames — the same update the
  loop runs, then a render — covering that much game time. Drawing is unaffected
  either way, so the canvas always shows the state the last frame left. Because
  every rate is integrated against the frame's delta, `advance(1, 1)` and
  `advance(1, 60)` reach the same outcome.
- `reset(options?)` and `snapshot()` — return every declared field to its
  title-screen value (seedable; `muted` deliberately kept) and read the fixed
  JSON-serializable view of the whole state, with cell centers, the level target,
  the multiplier, and whether a legal swap exists derived by the game's own rules.
- `start()`, `openHowTo()`, `pause()`, `resume()`, and `quit()` — pose exactly
  the choices the menus make.
- `loadBoard(rows)`, `setGem(col, row, token)`, `setScore`, `setLevel`,
  `setLevelScore`, `setCursor`, `setSelection`, and `clearSelection` — arrange
  the board and the round's figures. A board posed this way is a board like any
  other: it rests as written until a swap is accepted on it.
- `requestSwap(colA, rowA, colB, rowB)` — the same acceptance path a player's
  swap takes, so R1, R2, and R3 decide it and a refusal stands for
  `REFUSAL_SECONDS` like any other.
- `pointerDown(x, y)`, `pointerMove(x, y)`, and `pointerUp()` — feed the same
  input path the runtime's pointer feeds, each taking effect the moment it is
  called, so a selection and the swap it leads to are both posed without
  advancing the game at all.

Everything but the two clock calls is a read or a pose of the game's state: they
arrange the board, and the game's own acceptance rules, chain resolution,
scoring, and end conditions run from there. There is deliberately no operation
for the registered actions (the runtime's keyboard is driven by dispatching real
key events at the page) and none for the overlay (the runtime owns the backtick
key).

The surface is inert during normal play. All randomness runs off the seeded
generator state the snapshot reports as `rngState`, so a given seed deals the
same opening board and the same refills exactly.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed. The asset tools are **not**
  needed: the files they produced are committed.

## Install

```sh
npm ci
```

The one runtime dependency is `@test-cabinet/particle-runtime`, resolved by
relative path out of this monorepo. Everything else the game runs on is in
`src/`.

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
with `index.html` at its root and the produced assets copied under
`dist/assets/`. Every reference in the build is page-relative, so the directory
serves correctly from the root of a static host **and** from a sub-path:

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
The core's rules are checked directly; the runtime's modules are checked over
event targets and surfaces of the test's own; and the renderer is checked by
drawing through a real `@napi-rs/canvas` context and reading the pixels back —
including a check that every one of the 32 produced gem sprites really does fit
inside `GEM_R` of its cell center, which the 72-unit cell pitch depends on.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (base "./", emits to dist/)
vitest.config.ts      The build's own test suite, over src/
public/assets/        The produced art, effects, and audio, copied into dist/
src/
  main.ts             Bootstrap: stand the runtime up, initialize, install, run
  runtime.ts          The frame loop, the manual clock, and the wiring
  viewport.ts         The canvas fit and the pointer map: scale, letterbox, dpr
  keyboard.ts         Named actions over key codes, with edge detection
  pointer.ts          The pointer in stage units: samples, position, edges
  assets.ts           The produced-file manifest and its background loader
  audio-bus.ts        Web Audio over the produced .wav files, and the unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Every figure the specs fix (logical 1280x720)
  theme.ts            This build's own look: palette, type, bench placement
  core/               The whole simulation, framework-free (see above)
  game.ts             The per-frame update and the three functions the runtime
                      drives, plus the bridge to the presentation
  effects.ts          The break sheets and the live particle bursts
  debug.ts            The pose surface and the installed window.__facet
  input.ts            The registered actions, read as edges
  audio.ts            The eight cues, the chain ladder, and the music beds
  diagnostics.ts      The values the overlay shows
  render.ts           The frame, drawn: one switch on the screen
  render.board.ts     The bench, the stones, the effects, and the three marks
  render.gems.ts      One gem: its sprite, its cut overlay, its turn
  render.hud.ts       The score, the level, the meter, and the chain readout
  render.screens.ts   Title, how to play, paused, and the end of a round
  *.test.ts           The build's own tests, beside the code they cover
```
