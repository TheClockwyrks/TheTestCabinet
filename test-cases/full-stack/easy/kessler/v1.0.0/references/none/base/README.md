# Kessler

An orbital demolition arcade game that runs entirely in the browser, on no
engine. A planet sits at the center of the field, circled by three
counter-rotating rings of derelict satellites slated for demolition. You ride
the deflector around a low track above the planet, batting a demolition ball
outward into the rings; where the ball meets the deflector steers the bounce.
Breaking derelicts may shed salvage pods — catch one for a tool. A ball you
miss burns up against the planet, and the run ends when the last ball is lost
with no lives left. Play is a score attack over endless waves.

The game stands on no engine and no backend: the frame loop and its fixed
60 Hz tick, the canvas fit, the keyboard, the audio bus, the particle
playback, and the diagnostics overlay are all part of this project. The one
library is `@clockwyrks/particle-runtime`, resolved from this repository's
own `packages/` through a relative `file:` dependency, which plays the
produced particle systems.

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

The rules live apart from the machinery that runs them: everything under the
first heading is pure and unit-tested; everything under the second touches
the browser.

### The rules of the game

- `src/constants.ts` — every figure the specification fixes, in one place.
- `src/polar.ts` — the polar and vector helpers the angular rules read by.
- `src/rng.ts` — the seeded mulberry32 stream; only pod draws consume it.
- `src/state.ts` — the `Session` and the wave layouts.
- `src/rings.ts` — ring slot and target-arc geometry.
- `src/reflect.ts` — the deflector bounce and the reflection pipeline every
  other surface resolves through.
- `src/sim.ts` — one tick of the playing screen, its six steps in spec
  order.
- `src/game.ts` — the six screens, the menus, and the tick accumulator
  wrapped around the simulation.
- `src/debug.ts` — the state half of `window.__kessler`: pure reads and
  loud-validating poses.
- `src/diagnostics.ts` — the named, read-only sources the overlay reports.

### The runtime beneath them

- `src/viewport.ts` — letterboxed uniform fit of the 1000 × 1000 logical
  stage, DPR-aware.
- `src/input.ts` — the keyboard, as held keys and per-press edges by
  `KeyboardEvent.code`, and the pointer, as stage-space samples the menus
  answer.
- `src/menus.ts` — where the two menus sit: the hit region of each entry, and
  which entry a stage point is over.
- `src/runtime.ts` — the requestAnimationFrame loop, the accumulator, and
  the clock `setAutoStep`/`step` take hold of.
- `src/assets.ts` — loads the committed produced assets; every load failure
  degrades to a code-drawn or silent fallback.
- `src/theme.ts`, `src/draw.ts`, `src/render.ts`, `src/screens.ts` — the
  palette, the drawing helpers, the field, and each screen's chrome.
- `src/fx.ts` — the three produced particle systems, played live on the
  field's own canvas.
- `src/audio.ts` — the Web Audio bus: thirteen cues, two music beds, first-
  gesture unlock.
- `src/overlay.ts` — the Backquote diagnostics panel.
- `src/surface.ts`, `src/main.ts` — assembling `window.__kessler` and wiring
  the whole build together.

Tests sit beside what they test as `src/*.test.ts` and run in Node with no
browser.

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

## The showcase

`showcase/` holds the store-page presentation: `showcase.md` (the player's
description), `showcase.toml` (the carousel), and the captured media the
carousel names. To recapture the media, build first, then let the game play
itself — the capture script serves `dist/`, reads the field through the
game's own snapshot, and presses the same keys a player presses:

```sh
npm run build
node scripts/capture-showcase.mjs   # needs Playwright's Chromium
```

## Debugging and automation

Once the game has initialized it installs `window.__kessler`, a read/pose
surface for driving the game from code — stepping the fixed 60 Hz simulation
off real time, posing state, and reading the full snapshot. The overlay on
`Backquote` shows the live diagnostics.
