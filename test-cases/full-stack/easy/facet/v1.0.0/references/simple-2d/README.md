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
and its own cut pattern. Swap a stone with the one beside it and any line of
three or more of one kind shatters; the stones above fall into the gap and fresh
ones drop in from the top.

Facet's defining idea is **strain**. Every clear presses on the gems around it,
and a gem that has taken enough of that pressure is **flawed**: it shatters with
any clear that touches it and is worth double. So a swap made beside a worn
stretch of the board runs on and on, and the board a player leaves behind
decides what the next swap is worth. A line of four leaves a **brilliant**,
which takes the ring of stones around it; a line of five or more leaves a
**prism**, which — swapped against a stone — takes every stone of that kind; a
line crossing another leaves a **star**, which takes its whole row and column.

A round runs level after level, each asking for more points than the one before
it, and it ends when the board holds no swap that would shatter anything.

Everything on the bench other than the chrome is **produced by this build**: the
gem sprites at all four strain states, the break sheets, the prism's idle turn,
the three particle systems, and every sound and both music beds. They are
committed under `public/assets/` and bundled by the build, which invokes no
asset tool.

This is a self-contained static web app — plain **TypeScript** over the engine,
drawing to an **HTML5 canvas**, bundled with **Vite**. No backend, accounts,
network calls, or API keys; everything needed to play is in the built bundle.

## Controls

The pointer plays the board; the keyboard plays the board and drives the menus.
Every keyboard control is a **registered engine action** on the `dpad-4` touch
layout:

| Action                           | Keys               | Does                                                              |
| -------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `up` / `down` / `left` / `right` | Arrows or `WASD`   | Moves the cursor on the board, and the highlight on a menu.       |
| `confirm`                        | `Enter` or `Space` | Selects the cursor's cell, or swaps with it; accepts a menu item. |
| `pause`                          | `P`                | Enters and leaves the pause screen from the board.                |
| `back`                           | `Esc`              | Leaves how-to-play, the pause screen, and the end of a round.     |
| `mute`                           | `M`                | Toggles sound, on any screen.                                     |

**Pointer:** press a stone to select it, then press the stone beside it to swap
— or hold and **drag** onto the neighbor, which asks for the same swap without
a second press. Pressing the selected stone again clears the selection, and
pressing any other stone moves it. A swap that would shatter nothing is refused
and both cells are marked.

The **backtick** key (`` ` ``) toggles the engine's debug overlay, which shows
the screen and phase, the board's size, the score, the level against its target,
the chain step and multiplier, what the last step cleared and scored, the cursor
and selection, whether a legal swap exists, and the pointer. That key belongs to
the engine, not to this game.

## What the engine owns

`@test-cabinet/simple-2d` supplies everything that is the same in every browser
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

Three fields go past `specs/state.md`'s declaration, because the rules it fixes
cannot be written without them and no declared field yields them: `chainSwap`,
which R8 reads to place a created gem; and `pressedCell` with `dragSwapped`,
which carry a drag across the frames of one hold. They are documented where they
are declared, `reset` restores all three, and the snapshot reports none of them.

## The produced files

`specs/assets.md` is the contract, and every file it asks for was produced with
the six asset tools and committed under `public/assets/`:

| Under `public/assets/` | What                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `gems/*.png`           | The seven kinds at four strain states, the prism at four, the two cut overlays, and the bench frame  |
| `gems/break/<kind>/`   | A six-frame shatter sheet per kind                                                                   |
| `gems/prism-turn/`     | The prism's eight-frame idle turn                                                                    |
| `fx/*.system.json`     | The clear burst, the flawed detonation, and the cut flash                                            |
| `audio/*.wav`          | The seven synthesized cues, the eight ladder rungs, the sampled shatter body, and the two music beds |
| `audio/*.mid`          | The portable score `music` emits beside each bed                                                     |

`src/assets.ts` is the single list of what exists; nothing else in the build
spells an asset path. Every path is **page-relative** and resolved under the
engine's `assets/` root, so the site runs from a sub-path as well as from the
root of a host. `initialize` awaits the whole manifest, and a file that does not
arrive degrades rather than throwing: its lookup answers `null`, the renderer
falls back for it, and the game stays playable.

The particle systems are **simulated live** through
`@test-cabinet/particle-runtime`'s `ParticleCanvasPlayer`, so they vary from play
to play. The break sheets, the prism's turn, and the bursts are decoration and
deliberately live outside the state (`src/effects.ts`), which is derived from
what each chain step cleared and never read back.

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
await engine.advance(60);
const { score, lastCleared, legalSwap } = engine.debug.snapshot(engine.state);
```

The operations are `reset` (seedable), `snapshot`, `start`, `openHowTo`,
`pause`, `resume`, `quit`, `loadBoard`, `setGem`, `setScore`, `setLevel`,
`setLevelScore`, `setCursor`, `setSelection`, `clearSelection`, `requestSwap`,
and the immediate-effect pointer trio `pointerDown` / `pointerMove` /
`pointerUp`. The pointer operations do not stand in for the engine's pointer —
they feed the **same resolution path** its samples feed, so the hit radius, the
four press rows, the drag, and the acceptance rules run exactly as they do in
play. Everything about _driving a browser game_ — the clock, exact frames, key
events, the overlay — is the engine's, which is why the surface carries no
`setAutoStep` and no `advance`. It is inert during normal play.

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

The engine (`@test-cabinet/simple-2d`) and the particle runtime
(`@test-cabinet/particle-runtime`) are relative `file:` dependencies on the
repository's `packages/`, which npm installs as symlinks, so this project builds
and tests against their current source. A run receives the same packages under
`.tcab/` instead, so the imports in the sources are the same either way.

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
**engine's own asset path** off the committed tree and drawn, a chain is climbed
step by step and its ladder rungs checked, and the same interval of game time is
shown to reach the same state however it was divided into frames.

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
    controls.ts       Selecting, swapping, the cursor, and the pointer
    deal.ts           Dealing an opening board
    flow.ts           The screens and their menus
    rng.ts            The seeded generator: a draw beside the next state
    debug.ts          The pose logic behind the debug surface, and the snapshot
    fixtures.ts       Boards the core's own tests are written against
  assets.ts           The manifest of produced files, and the store that holds them
  audio.ts           The engine cues over the produced sounds, and the beds
  input.ts            The registered actions and their edge reads
  diagnostics.ts      The values the engine's overlay shows
  debug.ts            The debug surface: poses and readings over FacetState
  effects.ts          The break sheets and the particle bursts a chain throws
  scratch.ts          The one drawing surface the engine does not supply
  theme.ts            This build's own look: palette, type, and the bench's placement
  render*.ts          All canvas drawing, in logical space
  *.test.ts           The build's own tests, beside the code they cover
```
