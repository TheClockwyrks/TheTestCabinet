# Facet

A match game of cut stones, played on a lit gem board in the browser.

The board is an eight-by-eight field of faceted stones in seven kinds. Take
hold of a stone, carry it onto the one beside it, and let go: any line of three
or more of one kind shatters, the stones above fall into the gap, and fresh ones
drop in from the top. A hold carried back where it started plays nothing, so a
move can be seen before it is committed to.

Facet's defining idea is **strain**. Every clear presses on the stones around
it, and a stone that has taken enough of that pressure is **flawed**: it
shatters along with any clear that touches it, and it is worth double. So a
swap made beside a worn stretch of the board runs on and on, and each step of a
chain is worth more than the one before it.

Longer lines leave something behind. A line of four leaves a **brilliant**,
which takes the ring of stones around it. A line of five or more leaves a
**prism**, which — swapped against a stone — takes every stone of that kind on
the board. A line crossing another leaves a **star**, which takes its whole row
and its whole column.

Reach a level's target and the level is over, totted up on its own screen before
the next one is dealt. A round ends when no move is left that would shatter
anything.

## Controls

The board is played with the pointer alone — a mouse, a pen, or a finger, all
reaching the same path. Every screen carries pointer targets besides, so a
player with nothing but a touchscreen reaches all of them; the keyboard drives
the menus from the other side.

| Input             | Does                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| Pointer           | Press a stone to take hold of it, carry it onto the one beside it, and let go to play. |
| Pointer           | Press and release inside a menu row, the `PAUSE` control, or the `BACK` control.       |
| Arrow keys        | Move the highlight through a menu.                                                     |
| `Enter` / `Space` | Choose the highlighted menu item.                                                      |
| `Escape` / `P`    | Raise the pause menu from the board, and drop it again.                                |
| `Escape`          | Leave how-to-play and the end of a round.                                              |
| `M`               | Sound on and off.                                                                      |
| `` ` ``           | The engine's debug overlay.                                                            |

## Running it

```sh
npm ci          # install dependencies
npm run dev     # a development server, with hot reload
npm run build   # the production build, into dist/
npm run preview # serve the production build
```

`npm run build` writes a complete, self-contained static site into `dist/`, with
`index.html` at its root. Every URL it emits is page-relative, so the directory
runs correctly served at the root of a static host **and** from a sub-path.
Nothing is fetched from outside `dist/` at run time, and no key or credential is
needed to build, run, or play.

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run --coverage
```

The tests run in process, in Node, with no browser: they stand a real engine up
over an `@napi-rs/canvas` canvas and a surface of their own, pose a board
through `engine.debug`, step it with `engine.advance` against a fixed clock, and
read the world's own state, the cues the bus emitted, and the pixels the render
produced back. `src/harness.ts` is that rig.

## How it is put together

The game is built on the **Structured 2D** engine, which owns the frame loop and
the delta time, the canvas fit and the camera, rendering, the input actions and
the pointer, audio, asset loading, and the debug overlay. Facet is written
inside its framework — a game instance, a game mode, an actor with its draw
components, and a player controller — and `src/main.ts` is the whole of the
wiring.

| Module                           | Holds                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/game.ts`                    | The state contract, the game instance, the game mode, and the one-level definition.                                              |
| `src/core/`                      | The rules: the board, R1–R9, the chain cadence, the screens, the deal, and the pose logic. It imports no engine and no renderer. |
| `src/bridge.ts`                  | The one seam between the engine's live state and the core's.                                                                     |
| `src/controller.ts`              | The one seat input is read from: the actions, and the pointer's ordered samples.                                                 |
| `src/frame.ts`, `src/steps.ts`   | One frame of simulation, the per-step reports, and the cues it plays.                                                            |
| `src/bench.ts`, `src/render*.ts` | The actor, its two draw layers, and everything drawn on them — including where a stone is at this instant.                       |
| `src/effects.ts`                 | The break sheets, the bursts a chain throws, the aura every cut stone carries, and the clock a fresh deal pours on.              |
| `src/assets.ts`, `src/audio.ts`  | The produced files, and the cues declared over them.                                                                             |
| `src/debug.ts`                   | The debug and automation surface the engine returns from `engine.debug`.                                                         |
| `src/theme.ts`                   | The look: the palette, the type, and where the produced bench sits.                                                              |

## The board in motion

Nothing on the board teleports, and `specs/rules.md` fixes every span of it. An
accepted swap exchanges its two cells at once and then carries the two stones
between them over `SWAP_SECONDS`. A chain step's clear set shatters in waves, a
cell at wave `w` going `w * WAVE_SECONDS` into the step, and the stones that
fill the gap fall from where they came from at `FALL_SECONDS_PER_ROW` a row.
Every gem carries `fell`, how far it traveled to reach its cell, so the
renderer needs nothing the state does not already hold — and a freshly dealt
board, whose every gem carries a `fell` of at least `row + 1`, pours in from
above the top row on the same arithmetic.

`src/render.board.ts` is where that lives: one function says where a stone is,
and the stones are drawn clipped to the felt field so a falling one rises out of
the bench's own edge.

Everything the game shows other than its chrome is a file produced with the
asset tools and committed under `public/assets/`: the gem sprites at every
strain state, the two cut overlays, the board frame, a break sheet per kind, the
prism's idle turn, four particle systems — three one-shots a chain throws and
the aura that runs continuously at every brilliant, star, and prism standing on
the board — nine cues, an eight-rung chain ladder, and two pieces of music. The
build bundles them and invokes no tool.
