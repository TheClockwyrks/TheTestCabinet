# Facet — `simple-2d` reference implementation

The authored, **correct** reference build of the Facet full-stack test case, on
the [Simple 2D](../../../../../../../packages/simple-2d) engine. It is the
answer a run on `simple-2d` is compared against. It is **never seeded into a
run** — handing a model the finished game would defeat the test — and takes no
part in the case's seed set. The case specs under `../../specs/` remain
authoritative for the design.

The project is the case's seeded workspace with `src/game.ts` implemented, the
game split across new modules beside it, the produced art, effects, and sound
committed under `public/assets/`, and its own tests written alongside, so what is
here is exactly what a run on this engine is asked to produce.

---

**Facet** is a match game of cut stones, played in the browser on a lapidary's
bench after dark. The board is an eight-by-eight field of gems in seven kinds —
ruby, amber, citrine, jade, beryl, sapphire, amethyst — each with its own hue
and its own cut pattern. Take hold of a stone, carry it onto the one beside it,
and let go: any line of three or more of one kind shatters; the stones above
fall into the gap and fresh ones drop in from the top.

Facet's defining idea is **strain**. Every clear presses on the gems around it,
and a gem that has taken enough of that pressure is **flawed**: it shatters with
any clear that touches it and is worth double. So a swap made beside a worn
stretch of the board runs on and on, and the board a player leaves behind
decides what the next swap is worth. A line of four leaves a **brilliant**,
which takes the ring of stones around it; a line of five or more leaves a
**prism**, which — swapped against a stone — takes every stone of that kind; a
line crossing another leaves a **star**, which takes its whole row and column.

A round runs level after level, each asking for more points than the one before
it. Reaching a level's target opens a **level-clear** screen that tots up the
longest chain and the best single move that level was worth; a round ends when
the board holds no swap that would shatter anything.

Everything on the bench other than the chrome is **produced by this build**: the
gem sprites at all four strain states, the break sheets, the prism's idle turn,
the four particle systems, and every sound and both music beds. They are
committed under `public/assets/` and bundled by the build, which invokes no
asset tool.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## Controls

**The board is played with the pointer alone** — a mouse, a pen, or a finger,
all three reaching the same path. Press a stone to take hold of it, carry the
hold onto a stone beside it to offer the move, and **let go** to play it. While
an offer stands the two stones are drawn exchanged, so the move on the screen is
the move a release would play; carry the hold back where it started and the
offer is withdrawn, so letting go there plays nothing. A press away from every
cell lets the stone go. A move that would shatter nothing is refused and both
cells are marked.

The keyboard's whole job is the menus. Every keyboard control is a **registered
engine action** on the `single-vertical` touch layout:

| Action        | Keys               | Does                                               |
| ------------- | ------------------ | -------------------------------------------------- |
| `up` / `down` | Arrows             | Moves the highlight on a menu.                     |
| `confirm`     | `Enter` or `Space` | Accepts the highlighted menu item.                 |
| `pause`       | `Esc` or `P`       | Enters and leaves the pause screen from the board. |
| `back`        | `Esc`              | Leaves how-to-play and the end of a round.         |
| `mute`        | `M`                | Toggles sound, on any screen.                      |

`Esc` fires both `pause` and `back`, and the two act on screens that do not
overlap, so one key raises the pause menu from the board, drops it again, and
backs out of every other screen that can be backed out of.

**Every screen also carries pointer targets**, so a player with only a finger
reaches every choice: `menu-<i>` per item on the title, pause, level-clear, and
game-over menus, a `BACK` control on how-to-play, and a `PAUSE` control beside
the board. Each is at least 96 x 72 logical units, wholly on the stage, and drawn
exactly where `src/core/targets.ts` reports it — the rectangle the player presses
and the rectangle the game hit-tests are one rectangle. Moving over a menu row
highlights it, a press arms it, and a release inside it takes it.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen and phase, the board's size, the score, the level against its target,
the chain step and multiplier, what the last step cleared and scored and what it
set in motion, the held cell and the offered cell, the level's best move and
longest chain, whether a legal swap exists, and the pointer with its device. That
key belongs to the engine, not to this game.

## What the engine owns

`@clockwyrks/simple-2d` supplies everything that is the same in every browser
game, and none of it is written here: the frame loop and its delta time in
seconds, the state held by value and handed out `DeepReadonly`, the canvas fit
(uniform scale, centered letterbox, device pixel ratio), named keyboard actions
with edge detection, **the pointer** — position already in logical stage units,
press/release edges, and the ordered per-frame sample list a sweep arrives as —
**asset loading** under a fixed `assets/` root, the **audio bus** with its
looping cues, mute, and first-gesture unlock, and the debug overlay. What is left
is the game: the rules, the board, the screens, the drawing, the produced files,
and the state the debug surface poses.

## The rules live in `src/core/`

`src/core/` is Facet's whole simulation — the board and its notation, R1 to R9,
the chain cadence and scoring, the screens, and the pose logic behind the debug
surface — written against nothing but the figures in `src/constants.ts`, with no
engine, no renderer, and no DOM anywhere in it. It is **the same directory in
every reference build of this case**, so a score recorded under one engine means
what it means under another.

`src/bridge.ts` maps between the state `specs/state.md` declares — one
`GemState` per cell, one `RefusalState` carrying its timer — and the record the
core runs on, in both directions and without loss. The map is why the core can
be shared verbatim while this build declares exactly the state its own engine's
specification fixes.

## The state is a value

Nothing in this build writes to a state it was handed. Every field of
`FacetState` is `readonly` and every array a `readonly` array, so the declared
type and the `DeepReadonly` view the engine hands out are the same shape, and
every function over the state is a **transition**: current state in, next state
out, built by spreading what it keeps around what it changes. `render` and every
diagnostic source are reads of the state they are given, and the compiler — not
a convention — is what says they cannot change it.

One field goes past `specs/state.md`'s declaration, because the rules it fixes
cannot be written without it and no declared field yields it: `chainSwap`, the
pair the running chain began with, which R5 reads to seed a prism chain and R8
reads to place a created gem — and which the renderer reads to draw the two
stones travelling while `phase` is `swapping`. It is documented where it is
declared, `reset` restores it, and the snapshot does not report it.

## The produced files

`specs/assets.md` is the contract, and every file it asks for was produced with
the six asset tools and committed under `public/assets/`:

| Under `public/assets/` | What                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `gems/*.png`           | The seven kinds at four strain states, the prism at four, the two cut overlays, and the bench frame  |
| `gems/break/<kind>/`   | A six-frame shatter sheet per kind                                                                   |
| `gems/prism-turn/`     | The prism's eight-frame idle turn                                                                    |
| `fx/*.system.json`     | The clear burst, the flawed detonation, the cut flash, and the looping cut aura                      |
| `audio/*.wav`          | The eight synthesized cues, the eight ladder rungs, the sampled shatter body, and the two music beds |
| `audio/*.mid`          | The portable score `music` emits beside each bed                                                     |

`src/assets.ts` is the single list of what exists; nothing else in the build
spells an asset path. Every path is **page-relative** and resolved under the
engine's `assets/` root, so the site runs from a sub-path as well as from the
root of a host. `initialize` awaits the whole manifest, and a file that does not
arrive degrades rather than throwing: its lookup answers `null`, the renderer
falls back for it, and the game stays playable.

The particle systems are **simulated live** through
`@clockwyrks/particle-runtime`'s `ParticleCanvasPlayer`, so they vary from play
to play. Three of the four are one-shots thrown at a cell; the fourth, the **cut
aura**, loops, and one player is held for every `brilliant`, `star`, and `prism`
standing on the board, taken up and given back as cuts arrive and clear, so a cut
stone is never still.

The break sheets, the prism's turn, the bursts, and the auras are decoration and
deliberately live outside the state (`src/effects.ts`), which is derived from
what each chain step cleared and never read back.

## The board is drawn in motion

`specs/rules.md` fixes every span, and each is read straight off the state rather
than remembered:

| In motion              | Timed from                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| An accepted swap       | `swapTimer / SWAP_SECONDS` while `phase` is `swapping`, over the pair in `chainSwap`                       |
| A shattering clear set | Each cell's **wave**, `w * WAVE_SECONDS` into the step, which is when that cell's break sheet and burst go |
| A falling stone        | Its own `fell`, starting at `lastWaves * WAVE_SECONDS` and taking `fell * FALL_SECONDS_PER_ROW`            |
| An offer standing      | The held stone and the offered one drawn exchanged                                                         |

Every gem carries `fell`, the rows it traveled to reach its cell, so the
renderer knows where each one came from and needs no memory of the board before.
A freshly dealt board gives every gem a `fell` of at least `row + 1`, so a new
level pours in from above; the only figure `src/effects.ts` holds for it is how
long that board has been standing, because a deal has no chain step to time it.

## Debugging and automation

The game exposes the debugging and automation surface `specs/instrumentation.md`
fixes, **through the engine**: `src/debug.ts` builds it, `initialize` returns it
beside the state as `[state, createDebugApi()]`, and a caller reads that same
object back off **`engine.debug`**. Nothing is published on the page.

Every operation is a pose or a reading over `FacetState`, written in the shape of
`update`:

```ts
engine.apply((s) =>
  engine.debug.loadBoard(s, [
    "R0 A0 C0 J0 B0 S0 M0 R0",
    "J0 R0 R0 C0 B0 A0 C0 J0",
    "M0 R0 A0 R0 J0 B0 S0 M0",
    "C0 J0 B0 S0 M0 R0 A0 C0",
    "S0 M0 R0 A0 C0 J0 B0 S0",
    "A0 C0 J0 B0 S0 M0 R0 A0",
    "B0 S0 M0 R0 A0 C0 J0 B0",
    "R0 A0 C0 J0 B0 S0 M0 R0",
  ]),
);
engine.apply((s) => engine.debug.requestSwap(s, 3, 1, 3, 2));
await engine.advance(120);
const { score, lastCleared, legalSwap } = engine.debug.snapshot(engine.state);
```

The operations are `reset` (seedable), `snapshot`, `start`, `openHowTo`,
`pause`, `resume`, `quit`, `loadBoard`, `setGem`, `setScore`, `setLevel`,
`setLevelScore`, `setBestChain`, `setBestMove`, `continueLevel`, `setSelection`,
`clearSelection`, `setOffer`, `clearOffer`, `requestSwap`, and the
immediate-effect pointer trio `pointerDown` / `pointerMove` / `pointerUp`, each
of which takes a trailing device (`"mouse"`, `"pen"`, or `"touch"`, defaulting to
`"mouse"`). The pointer operations do not stand in for the engine's pointer —
they feed the **same resolution path** its samples feed, so the hit radius, the
press table, the offer, the release, the screen's targets, and the acceptance
rules run exactly as they do in play. Everything about _driving a browser game_ —
the clock, exact frames, key events, the overlay — is the engine's, which is why
the surface carries no `setAutoStep` and no `advance`. It is inert during normal
play.

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

The engine (`@clockwyrks/simple-2d`) and the particle runtime
(`@clockwyrks/particle-runtime`) are relative `file:` dependencies on the
repository's `packages/`, which npm installs as symlinks, so this project builds
and tests against their current source. A run receives the same packages under
`.vendor/` instead, so the imports in the sources are the same either way.

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
with `index.html` at its root and the produced files beside it. It invokes no
asset tool. Serve that directory as-is from any static file server, at its root
or under a sub-path:

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
`engine.advance` against a `ConstantClock`, drives the keyboard and the pointer
by dispatching events at the surface's event target, poses scenarios through
`engine.apply`, and reads results back from the state, the debug surface, the
engine's cue events, and the pixels the render produced. No browser is involved.
Among the suite: every produced sprite and particle system is loaded through the
**engine's own asset path** off the committed tree and drawn, a whole move is
played with a mouse and again with a finger, every screen's pointer targets are
shown to carry paint where the game hit-tests them, a chain is climbed step by
step and its ladder rungs checked, a swap and a fall are read at points along
their own timelines, and the same interval of game time is shown to reach the
same state however it was divided into frames.

## Project layout

```
index.html            Vite entry; hosts the <canvas>, sized by CSS alone
vite.config.ts        Build config (relative base; emits to dist/)
vitest.config.ts      The build's own test suite, over src/
public/assets/        The produced sprites, sheets, systems, and sounds
src/
  main.ts             Bootstrap: create the engine, initialize it, and run
  constants.ts        Every figure the specification fixes (logical 1280x720);
                      seeded by the case and not edited
  game.ts             The FacetState contract and the three functions the
                      engine drives
  bridge.ts           The map between that state and the core's own record
  frame.ts            One frame: input, pointer, game time, cues, and the
                      chain steps handed to the presentation
  core/               The shared simulation — identical in every reference
                      build of this case
    state.ts          The record every rule is written on, and its resting values
    board.ts          Cell geometry, cell access, and the board notation
    rules.ts          R1 to R9, as pure functions of a board
    chain.ts          A chain step's order, its cadence, scoring, levels, and
                      the end of a round
    controls.ts       Taking hold, offering, releasing, and the screens' targets
    targets.ts        Every screen's pointer targets, and the hit test over them
    deal.ts           Dealing an opening board
    flow.ts           The screens and their menus
    random.ts         The game's own random source
    debug.ts          The pose logic behind the debug surface, and the snapshot
    fixtures.ts       Boards the core's own tests are written against
  assets.ts           The manifest of produced files, and the store that holds them
  audio.ts           The engine cues over the produced sounds, and the beds
  input.ts            The registered actions and their edge reads
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The debug surface: poses and readings over FacetState
  effects.ts          The break sheets, the bursts a chain throws, the auras a
                      cut stone stands in, and the pour a new board arrives on
  scratch.ts          The one drawing surface the engine does not supply
  theme.ts            This build's own look: palette, type, and the bench's placement
  render*.ts          All canvas drawing, in logical space
  *.test.ts           The build's own tests, beside the code they cover
```
