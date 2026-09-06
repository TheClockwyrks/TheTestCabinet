# Kessler

An orbital demolition arcade game that runs entirely in the browser, built on
the **Simple 2D** engine. A planet sits at the center of the field, circled by
three counter-rotating rings of derelict satellites slated for demolition. You
ride the deflector around a low track above the planet, batting a demolition
ball outward into the rings; where the ball meets the deflector steers the
bounce. Breaking derelicts may shed salvage pods — catch one for a tool. A
ball you miss burns up against the planet, and the run ends when the last ball
is lost with no lives left. Play is a score attack over endless waves.

The engine (`@clockwyrks/simple-2d`) owns the frame loop and the delta time,
the letterboxed fit of the fixed 1000 × 1000 logical stage, the keyboard
actions, the audio cue bus with its looping beds, the asset loader, and the
debug overlay. The game owns everything else: its fixed 60 Hz tick built over
the engine's delta, the polar simulation, the six screens, the drawing, and
the produced assets it plays. `@clockwyrks/particle-runtime` plays the
produced particle systems into the same context the field is drawn into.

## Install

```sh
npm ci
```

## Run in development

```sh
npm run dev
```

Vite prints the local URL; open it and play.

## Production build

```sh
npm run build
```

The complete static site lands in `dist/`, self-contained, and runs when
served as-is — from the root of a static file server or mounted under a
sub-path alike. `npm run preview` serves it locally.

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run, with coverage
```

## Controls

The field is driven from the keyboard; the menus answer the pointer and touch
as well. Keys are bound by physical position (`KeyboardEvent.code`), so they
hold on any layout.

| Action                    | Keys                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| Rotate the deflector      | `ArrowLeft` / `KeyA` and `ArrowRight` / `KeyD` (held)                        |
| Launch the parked ball    | `Space`                                                                      |
| Menus: move the highlight | `ArrowUp` / `KeyW` and `ArrowDown` / `KeyS`                                  |
| Menus: confirm            | `Space` or `Enter`                                                           |
| Menus: pointer or touch   | Move onto an entry to highlight it; press and release inside it to accept it |
| Pause / back              | `Escape` or `KeyP`                                                           |
| Debug overlay             | `Backquote` (`` ` ``)                                                        |

## The source, file by file

The rules live apart from the machinery that draws them: everything under the
first heading is pure and unit-tested in Node; the second heading is the
engine binding and the drawing.

### The rules of the game

- `src/constants.ts` — every figure the specification fixes, in one place
  (supplied with the project).
- `src/figures.ts` — those figures re-derived into the simulation's own
  vocabulary: the formula tables and the pod-kind lookup.
- `src/polar.ts` — the polar and vector helpers the angular rules read by.
- `src/rng.ts` — the seeded mulberry32 stream as a pure state step; only pod
  draws consume it.
- `src/state.ts` — the `Session` and the wave layouts.
- `src/rings.ts` — ring slot and target-arc geometry.
- `src/reflect.ts` — the deflector bounce and the reflection pipeline every
  other surface resolves through.
- `src/sim.ts` — one tick of the playing screen, its six steps in spec order.
- `src/flow.ts` — `KesslerState` itself, the six screens, the menus, the tick
  accumulator, and the pure transitions the engine's frames are made of.
- `src/debug.ts` — the debug surface: a pure `snapshot` reading and
  loud-validating poses, each written in the shape of `update` and driven
  through `engine.apply`.
- `src/diagnostics.ts` — the named, read-only sources the engine's overlay
  reports.

### The engine binding and the drawing

- `src/game.ts` — the `Game<KesslerState, KesslerDebugApi>` the engine
  drives: `initialize`, the per-frame `update`, and `render`.
- `src/input.ts` — the action registrations and the per-frame reads, the
  pointer's samples included.
- `src/menus.ts` — where the two menus sit: the hit region of each entry, and
  which entry a stage point is over.
- `src/audio.ts` — the thirteen cues and two beds on the engine's cue bus,
  each declared as a synth fallback and then loaded from its produced file.
- `src/assets.ts` — the produced sprites and particle systems through the
  engine's asset loader; every load failure degrades to a code-drawn or
  silent fallback.
- `src/theme.ts`, `src/draw.ts`, `src/render.ts`, `src/screens.ts` — the
  palette, the drawing helpers, the field, and each screen's chrome.
- `src/fx.ts` — the three produced particle systems, played live through
  `@clockwyrks/particle-runtime`'s canvas binding on the render context.
- `src/main.ts` — the fixed entry point (supplied with the project).

Tests sit beside what they test as `src/*.test.ts` and run in Node with no
browser — the engine harness tests stand a real engine up over an
`@napi-rs/canvas` canvas and a `ConstantClock` and drive it with dispatched
keyboard events.

## The art and the sound

Kessler ships no third-party art or audio. The planet and pod sprites, the
ball's six spin frames, the three particle systems, the thirteen sound cues,
and the two music beds were all produced with the asset-generation tools
during this build and committed under `assets/`. `ASSET-LAYOUT.md` maps every
file: where it lands, its native size, which script produces it, and the
loader key it is consumed under. The build bundles the committed files and
never invokes a tool, so the project builds wherever the tools are absent.

Regenerating them, when the tools are on the `PATH`:

```sh
bash scripts/gen-sprites.sh   # planet, pods, the ball's spin frames (draw, draw-sheet)
bash scripts/gen-fx.sh        # burst, spark, burn-up system.json (particle-2d)
bash scripts/gen-audio.sh     # the 13 cues and 2 music beds (sfx-synth, music)
```

Each script resolves its tools from the `PATH` first and falls back to
`$CARGO_TARGET_DIR/{release,debug}`; see each script's header.

## Debugging and automation

`initialize` returns the debug surface beside the state, and the engine hands
it back from `engine.debug` — nothing is installed on the page. A caller
poses the game through `engine.apply((s) => engine.debug.setScore(s, 500))`,
steps it off real time with `engine.advance` under a `ConstantClock` of
`1000 / 60` milliseconds, and reads it back with
`engine.debug.snapshot(engine.state)`. The overlay on `Backquote` shows the
live diagnostics.

## The showcase

`showcase/` holds the store-page presentation: `showcase.md`, the carousel in
`showcase.toml`, a replay of sustained live play captured with the engine's
own recorder, and stills of the same run. Recapture it with a dev server and
Playwright via `node scripts/capture-showcase.mjs`.
