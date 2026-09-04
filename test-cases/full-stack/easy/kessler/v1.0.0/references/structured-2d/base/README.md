# Kessler

An orbital demolition arcade game built on the Structured 2D engine, running
entirely in the browser. A planet sits at the center of the field, circled by
three counter-rotating rings of derelict satellites slated for demolition. You
ride the deflector around a low track above the planet, batting a demolition
ball outward into the rings; where the ball meets the deflector steers the
bounce. Breaking derelicts may shed salvage pods — catch one for a tool. A
ball you miss burns up against the planet, and the run ends when the last ball
is lost with no lives left. Play is a score attack over endless waves.

The game is written inside `@test-cabinet/structured-2d`'s framework — a game
instance, one game mode, actors and their draw components, and the player
controller that drives the deflector — and the engine owns the frame loop, the
canvas fit, rendering, the keyboard actions, the audio cue bus with its
looping beds, asset loading, and the debug overlay. Every contact is the
simulation's own polar crossing math over the world's game state; the produced
particle systems play through `@test-cabinet/particle-runtime`'s canvas
binding, from a draw component in the engine's layer order. There is no
backend: everything needed to play is in `dist/`.

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

The game is keyboard only. Keys are bound by physical position
(`KeyboardEvent.code`), so they hold on any layout.

| Action | Keys |
| --- | --- |
| Rotate the deflector | `ArrowLeft` / `KeyA` and `ArrowRight` / `KeyD` (held) |
| Launch the parked ball | `Space` |
| Menus: move the highlight | `ArrowUp` / `KeyW` and `ArrowDown` / `KeyS` |
| Menus: confirm | `Space` or `Enter` |
| Pause / back | `Escape` or `KeyP` |
| Debug overlay | `Backquote` (`` ` ``) — engine chrome, not a game action |

## The source, file by file

The rules live apart from the framework objects that run them: everything
under the first heading is pure arithmetic over the live game state and is
unit-tested in isolation; everything under the second is the engine-facing
half.

### The rules of the game

- `src/constants.ts` — every figure the specification fixes, in one place.
- `src/polar.ts` — the polar and vector helpers the angular rules read by.
- `src/rng.ts` — the seeded mulberry32 stream; only pod draws consume it.
- `src/figures.ts` — the wave formulas: ball speed, orbit speeds, the pod
  table.
- `src/session.ts` — the session records (balls, pods, effects) and the wave
  layouts.
- `src/rings.ts` — ring slot and target-arc geometry.
- `src/reflect.ts` — the deflector bounce and the reflection pipeline every
  other surface resolves through.
- `src/sim.ts` — one tick of the playing screen, its six steps in spec order.
- `src/flow.ts` — the six screens, the menus, the tick accumulator, and the
  session lifecycle.

### The engine-facing half

- `src/state.ts` — `KesslerState`, the world's live game state: the one
  authoritative record of everything a frame carries.
- `src/game.ts` — the game instance, the game mode, and the `GameDefinition`
  the engine drives; re-exports the state and the debug surface type.
- `src/controller.ts` — the player controller: the one seat the registered
  actions are read from.
- `src/input.ts` — the action registry: names and key bindings.
- `src/actors.ts` — the tagged actors that populate the field, their draw
  components, and the reconciler that keeps them mirroring the state.
- `src/theme.ts`, `src/draw.ts`, `src/render.ts`, `src/screens.ts` — the
  palette and layer table, the drawing helpers, the field, and each screen's
  chrome.
- `src/fx.ts` — the three produced particle systems, played live through the
  particle runtime into the render pipeline's context.
- `src/audio.ts` — the thirteen cues and two music beds on the engine's cue
  bus, each with a synthesized fallback under the produced file.
- `src/assets.ts` — loads the committed produced sprites and systems; every
  load failure degrades to a code-drawn fallback.
- `src/debug.ts` — the debug surface `initialize` returns: pure reads and
  loud-validating poses over the live world.
- `src/diagnostics.ts` — the named, read-only sources the engine's overlay
  reports.
- `src/main.ts` — the fixed entry point, supplied with the project.

Tests sit beside what they test as `src/*.test.ts` and run in Node with no
browser: the sim, flow, and math suites over the bare state, and the engine
suites over a real engine stood up on an `@napi-rs/canvas` canvas with a
`ConstantClock`, driven by `engine.advance` (`src/harness.ts`).

## The art and the sound

Kessler ships no third-party art or audio. The planet and pod sprites, the
ball's six spin frames, the three particle systems, the thirteen sound cues,
and the two music beds were all produced with the asset-generation tools
during this build and committed under `assets/`. `ASSET-LAYOUT.md` maps every
file: where it lands, its native size, which script produces it, and the
loader key it is consumed under. The build bundles the committed files (served
through `public/assets`) and never invokes a tool, so the project builds
wherever the tools are absent.

Regenerating them, when the tools are on the `PATH`:

```sh
bash scripts/gen-sprites.sh   # planet, pods, the ball's spin frames (draw, draw-sheet)
bash scripts/gen-fx.sh        # burst, spark, burn-up system.json (particle-2d)
bash scripts/gen-audio.sh     # the 13 cues and 2 music beds (sfx-synth, music)
```

Each script resolves its tools from the `PATH` first and falls back to
`$CARGO_TARGET_DIR/{release,debug}`; see each script's header.

## The showcase

`showcase/` holds the store-page presentation: `showcase.md`, the carousel in
`showcase.toml`, a replay of sustained live play captured with the engine's
own recorder, and stills of the same run. Recapture it with a dev server and
Playwright via `node scripts/capture-showcase.mjs`.
