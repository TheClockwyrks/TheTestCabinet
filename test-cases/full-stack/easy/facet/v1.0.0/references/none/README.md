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
chrome — the HUD, the level meter, the menus, the `PAUSE` and `BACK` controls,
the selection, offer and refusal marks, and the debug overlay — is drawn in
code.

The look is this build's own. The specs fix what must be legible — seven kinds
told apart by more than hue, four strain states reading as deepening damage, the
three cuts and the prism reading apart from a plain stone, every form inside
`GEM_R` of its cell center — and leave the palette, the type, and the artwork to
the build. This build chose a bench after dark: a warm near-black ground, brass
and candle-gold chrome, and the produced sprites carrying every hue on the
board. Those choices live in `src/theme.ts`, apart from the figures the specs fix
in `src/constants.ts`.

## Controls

The **pointer plays the board, and a mouse, a pen, and a finger all drive it**.
Press a stone to take hold of it, carry the pointer onto the stone beside it —
which **offers** the move, drawing the two stones exchanged — and let go to play
it. Carrying it back where it started withdraws the offer, so letting go there
plays nothing: a move is played only by a release with an offer standing.
Pressing a stone farther off moves the hold there, and pressing clear of the
board lets go of it.

Every screen also carries **pointer targets**, the rectangles
`src/core/targets.ts` reports and the renderer draws on: a plate per menu item,
a `BACK` control on how-to, and a `PAUSE` control in the strip to the right of
the board. Each is at least 96 x 72 logical units, so a fingertip works every
screen. Moving over an item highlights it, a press highlights and arms it, and a
release inside the armed one takes it.

The keyboard drives the menus, as **named actions** bound to physical keys
(`KeyboardEvent.code`), so the bindings survive a non-QWERTY layout:

| Action    | Keys               | Does                                     |
| --------- | ------------------ | ---------------------------------------- |
| `up`      | `ArrowUp`          | Moves the menu highlight up, wrapping.   |
| `down`    | `ArrowDown`        | Moves the menu highlight down, wrapping. |
| `confirm` | `Enter` or `Space` | Takes the highlighted item.              |
| `pause`   | `Esc` or `P`       | Enters and leaves the pause screen.      |
| `mute`    | `M`                | Toggles sound, on any screen.            |
| `back`    | `Esc`              | Leaves how-to and the end of a round.    |

`Esc` fires **both** `pause` and `back`, and the two act on screens that do not
overlap — `pause` on `playing` and `paused`, `back` on `howto` and `gameover` —
so a frame carrying both is unambiguous whichever it applies first.

The **backtick** key (`` ` ``) toggles the diagnostics overlay. That key belongs
to the runtime (`src/overlay.ts`), not to the game.

Nine audio cues — select, swap, refuse, clear, land, flaw, cut, level-up,
game-over — are produced `.wav` files played over Web Audio, unlocked by the
first gesture. `clear` sounds the **chain ladder**: the shatter body under one of
eight ascending tones, the rung chosen by the step's multiplier, so a long chain
climbs and holds at the top. `land` is the low knock a step's stones make when
the longest of them fell more than `LAND_MIN_ROWS` rows.

## What moves

Nothing on this board teleports, and `specs/rules.md` fixes how long each thing
takes. `src/motion.ts` is that arithmetic, and every sprite, mark, and aura is
placed through it, so a stone and everything drawn on it never come apart.

- **A swap.** An accepted swap exchanges its two cells at once and then travels:
  for `SWAP_SECONDS` the two stones are drawn between their cells, and only then
  does the first chain step resolve.
- **A shattering set.** R6 gives every cell of the clear set a **wave**, and the
  cell at wave `w` comes apart `w * WAVE_SECONDS` into the step — so the ring a
  brilliant takes goes after the run that lit it. `src/effects.ts` carries that
  delay as a negative age on the break sheet and as a queue in front of the
  burst.
- **Falling stones.** Every gem carries the `fell` R9 gave it, so the renderer
  knows how far above its cell it started: it holds there while the set
  shatters, then closes on its cell over `fell * FALL_SECONDS_PER_ROW`. A freshly
  dealt board's gems all carry a `fell` of at least `row + 1`, so a new level
  pours in from above with no extra state — the presentation times that one pour
  itself, because no timer in the game's state covers it.
- **A cut stone's aura.** Every `brilliant`, `star`, and `prism` standing on the
  board carries the looping `fx/cut-aura.system.json`, run continuously for as
  long as that stone stands in that cell and reconciled against the board every
  frame. A prism turns as well, on its own produced sheet.

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
| `fx/*.system.json`     | The clear burst, the flawed detonation, the cut flash, and the looping cut  | `particle-2d`             |
|                        | aura, all simulated live                                                    |                           |
| `audio/*.wav`          | The eight synthesized cues, the eight ladder rungs, and the sampled shatter | `sfx-synth`, `sfx-sample` |
| `audio/{title,play}.*` | The title theme and the play bed, each a `.wav` beside its `.mid` score     | `music`                   |

The four particle systems are played through
`@clockwyrks/particle-runtime`'s `ParticleCanvasPlayer` — the only runtime
dependency this build has — each simulated into a scratch canvas of its system's
own field size and blitted, additively, at the cell it belongs to. The scratch
canvases are pooled per system, and the auras are capped, so a board that has
earned a great many cut stones stays cheap to draw.

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
  release mapped into stage units and buffered in arrival order, so a hold that
  crossed a cell boundary between two frames offers into the cell it crossed.
  Each sample carries the **device** that drove it (`mouse`, `pen`, `touch`) and
  whether it was the primary pointer, so a second finger resting on a
  touchscreen changes nothing. It also **takes the browser's own gestures on the
  canvas** — `touch-action: none`, no text selection, no tap highlight, no
  context menu, no page scroll — and **captures each contact**, so a drag that
  leaves the canvas keeps delivering rather than being cancelled part way
  through.
- **`src/assets.ts`** — the manifest of every produced file and the loader that
  fetches it. Loading runs in the background from the first frame, so the game
  is up immediately and each sprite joins the picture on the frame after it
  lands; `window.__facet` is installed once every load has settled, since the
  specs make the load part of initialization.
- **`src/audio-bus.ts`** — cues declared by name over the produced `.wav`s,
  decoded once through `decodeAudioData` on a Web Audio context opened by the
  first user gesture, plus the looping music bed. Muting is a gain of zero on the
  master, not a skipped cue, and nothing about audio can fail a frame.
- **`src/overlay.ts`** — the diagnostics panel: the backtick key, the drawing in
  device space over the finished frame, and its read-only-ness. The game only
  names the values it shows.

`src/main.ts` is the whole of the wiring between that layer and the game.

## The core, and what sits on it

`src/core/` is Facet's whole simulation — the board and its notation, the random
source the deal and the refill draw from, R1 to R9, the chain cadence, the
screens and their menus, the opening deal, and the pose logic behind the debug
surface. It imports **nothing** but `src/constants.ts`: no engine, no renderer,
no DOM. It is the same core the case's `simple-2d` and `structured-2d` reference
builds carry, written once.

`src/game.ts` is the bridge. It reads the frame's input, hands the core the
frame's delta time, plays the cues the frame raised, and keeps the pointer and
mute mirrors honest. The one thing it adds is the link to the **presentation**
(`src/effects.ts`): the core reports _that_ a step cleared something, and the
shatter sheets and particle bursts need to know _which_ cells, so `reportFor`
re-derives it from the core's own R5, R6, and R8 over the board that step read.
None of that decoration is part of the state, because
`specs/instrumentation.md` rests on the state advancing from the delta time
alone.

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
  JSON-serializable view of the whole state, with cell centers, the level
  target, the multiplier, the board's longest fall, how long the step in
  progress holds, whether a legal swap exists, and the current screen's pointer
  targets all derived by the game's own rules.
- `start()`, `openHowTo()`, `pause()`, `resume()`, `continueLevel()`, and
  `quit()` — pose exactly the choices the menus make, `continueLevel` being
  `CONTINUE` on the level-clear screen.
- `loadBoard(rows)`, `setGem(col, row, token)`, `setScore`, `setLevel`,
  `setLevelScore`, `setBestChain`, `setBestMove`, `setSelection`,
  `clearSelection`, `setOffer`, and `clearOffer` — arrange the board, the
  round's figures, and the hold. A board posed this way is a board like any
  other: it rests as written until a swap is accepted on it, and an offer posed
  this way plays nothing until a release does.
- `requestSwap(colA, rowA, colB, rowB)` — the same acceptance path a player's
  release takes, so R1, R2, and R3 decide it, an acceptance travels for
  `SWAP_SECONDS` before its first step resolves, and a refusal stands for
  `REFUSAL_SECONDS` like any other.
- `pointerDown(x, y, device?)`, `pointerMove(x, y, device?)`, and
  `pointerUp(device?)` — feed the same input path the runtime's pointer feeds,
  over the screen's targets and over the board alike, each taking effect the
  moment it is called, so a hold and the move it plays are both posed without
  advancing the game at all. `device` is `"mouse"`, `"pen"`, or `"touch"` and
  defaults to `"mouse"`.

Everything but the two clock calls is a read or a pose of the game's state: they
arrange the board, and the game's own acceptance rules, chain resolution,
scoring, and end conditions run from there. There is deliberately no operation
for the registered actions (the runtime's keyboard is driven by dispatching real
key events at the page) and none for the overlay (the runtime owns the backtick
key).

The surface is inert during normal play. The deal and the refill draw from the
game's own random source, and a scenario that needs a refill pinned down poses
it with `setRefillKinds`.

## Requirements

- Node.js 20+ and npm. No other toolchain is needed. The asset tools are **not**
  needed: the files they produced are committed.

## Install

```sh
npm ci
```

The one runtime dependency is `@clockwyrks/particle-runtime`, resolved by
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
  main.ts             Bootstrap: stand the runtime up, initialize, run, install
  runtime.ts          The frame loop, the manual clock, and the wiring
  viewport.ts         The canvas fit and the pointer map: scale, letterbox, dpr
  keyboard.ts         Named actions over key codes, with edge detection
  pointer.ts          The pointer in stage units: samples, position, edges
  assets.ts           The produced-file manifest and its background loader
  audio-bus.ts        Web Audio over the produced .wav files, and the unlock
  overlay.ts          The diagnostics panel and the backtick key
  constants.ts        Every figure the specs fix (logical 1280x720)
  theme.ts            This build's own look: palette, type, bench placement,
                      and the plate a pointer target is drawn as
  motion.ts           Where a stone is drawn: the swap, the fall, the pour, and
                      the two stones an offer shows exchanged
  core/               The whole simulation, framework-free (see above)
  game.ts             The per-frame update and the three functions the runtime
                      drives, plus the bridge to the presentation
  effects.ts          The break sheets, the live particle bursts, the cut auras,
                      and the clock a freshly dealt board pours in on
  debug.ts            The pose surface and the installed window.__facet
  input.ts            The registered actions, read as edges
  audio.ts            The nine cues, the chain ladder, and the music beds
  diagnostics.ts      The values the overlay shows
  render.ts           The frame, drawn: one switch on the screen
  render.board.ts     The bench, the stones in motion, the effects, the marks
  render.gems.ts      One gem: its sprite, its cut overlay, its turn
  render.hud.ts       The score, the level, the meter, the chain readout, PAUSE
  render.screens.ts   Title, how to play, paused, level clear, end of a round
  *.test.ts           The build's own tests, beside the code they cover
```
