# Facet

A match game of cut stones, played on a lit gem board in the browser.

The board is an eight-by-eight field of faceted stones in seven kinds. Swap a
stone with the one beside it, and any line of three or more of one kind
shatters; the stones above fall into the gap and fresh ones drop in from the
top.

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

Reach a level's target and the next level opens, asking for more. A round ends
when no swap is left that would shatter anything.

## Controls

| Input                        | Does                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Pointer                      | Press a stone to select it, then press or drag onto the one beside it to swap. |
| Arrow keys / `W` `A` `S` `D` | Move the cursor over the board, and the highlight through a menu.              |
| `Enter` / `Space`            | Select the cursor's stone, then swap with it. Chooses a menu item.             |
| `P`                          | Pause and resume.                                                              |
| `M`                          | Sound on and off.                                                              |
| `Escape`                     | Leave how-to-play, the pause menu, and the end of a round.                     |
| `` ` ``                      | The engine's debug overlay.                                                    |

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
| `src/bench.ts`, `src/render*.ts` | The actor, its two draw layers, and everything drawn on them.                                                                    |
| `src/effects.ts`                 | The break sheets and the particle bursts a chain throws.                                                                         |
| `src/assets.ts`, `src/audio.ts`  | The produced files, and the cues declared over them.                                                                             |
| `src/debug.ts`                   | The debug and automation surface the engine returns from `engine.debug`.                                                         |
| `src/theme.ts`                   | The look: the palette, the type, and where the produced bench sits.                                                              |

Everything the game shows other than its chrome is a file produced with the
asset tools and committed under `public/assets/`: the gem sprites at every
strain state, the two cut overlays, the board frame, a break sheet per kind, the
prism's idle turn, three particle systems, eight cues, an eight-rung chain
ladder, and two pieces of music. The build bundles them and invokes no tool.
