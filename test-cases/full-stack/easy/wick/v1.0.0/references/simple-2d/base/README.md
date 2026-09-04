# Wick

A survival game of one lamplighter against the night, running entirely in the
browser on the Simple 2D engine. The lamplighter is alone in a moth-choked
city, and everything in the dark is drawn to the light. The player only
moves; the lamplighter's tools fire on their own, each on its own rhythm, and
what the player decides is where to stand and what to take at each level-up.
The night lasts ten minutes: reach dawn and the run is won, run out of health
and the lamplighter has fallen.

The engine (`@test-cabinet/simple-2d`) owns the frame loop and the delta
time, the letterboxed fit of the fixed 1280 x 720 logical stage, the keyboard
actions, the pointer in the stage's own coordinates, the audio cue bus with
its two looping cues, the asset loader, and the debug overlay. The game owns
everything else: its fixed 60 Hz tick built over the engine's delta, the
simulation, the nine screens, the drawing, and the produced sprites and
sounds it plays.

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
served as-is, from the root of a static file server or mounted under a
sub-path alike. `npm run preview` serves it locally. `public/assets` is a
link to the produced files under `assets/`, which is how the build copies
them into `dist/assets/` where the engine's loader expects them.

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --check .
npm test            # vitest run, with coverage
```

## Controls

The night is played from the keyboard, and every menu answers the mouse as
well. Keys are bound by physical position (`KeyboardEvent.code`), so they
hold on any layout.

| Action | Keys | Does |
| --- | --- | --- |
| Move | `ArrowUp` / `KeyW`, `ArrowDown` / `KeyS`, `ArrowLeft` / `KeyA`, `ArrowRight` / `KeyD` (held) | Moves the lamplighter; up and down also move a menu highlight, and left and right the almanac's tab |
| Confirm | `Enter` / `Space` | Accepts the highlighted item; closes the chest overlay |
| Back | `Escape` | Leaves the how-to screen and the almanac; pauses the night and resumes it; returns to the title from an end screen |
| Pause | `KeyP` | Pauses the night; resumes it |
| Mute | `KeyM` | Toggles sound, on every screen |
| Debug overlay | `` ` `` (backquote) | Shows and hides the engine's overlay: the screen, the clock, the loadout, the switches, and the mute bit |

The pointer moves the highlight to whatever it rests on, a click takes that
item, and the wheel scrolls the almanac's list.

## The source, file by file

The rules live apart from the machinery that draws them: everything under the
first heading is engine-free and unit-tested in Node, and the second heading
is the engine binding and the drawing.

### The rules of the game

- `src/constants.ts` — every figure the specification fixes, in one place
  (supplied with the project).
- `src/game.ts` — `WickState`, declared as the specification fixes it, the
  debug surface's type, `BACKGROUND`, and the `Game` the engine drives.
- `src/state.ts` — the idle and fresh runs, the writable draft a transition
  clones the state into, and the clone.
- `src/rng.ts` — the seeded generator, whose whole state is `rngState`.
- `src/stats.ts` — the derived stats the passives feed.
- `src/sim/` — one tick, phase by phase: the lamplighter, the enemies, the
  weapons' firing and the placement of the permanent shapes, the projectiles
  and zones, the hits, the drops, the spawn director, and progression.
- `src/flow.ts` — the screens, the menus, the pointer's three rules, the tick
  accumulator, and the frame: every edge answered against the screen the frame
  began on.
- `src/menus.ts` — where every menu sits on the stage, drawn and clicked from
  the one definition.
- `src/almanac.ts` — what the almanac browses: every tool, trinket, enemy, and
  pickup with its picture, its figures, and its line.
- `src/debug.ts` — the debug surface: a pure `snapshot` reading and
  loud-validating poses, each written in the shape of `update`.
- `src/diagnostics.ts` — the read-only sources the engine's overlay reports.

### The engine binding and the drawing

- `src/input.ts` — the action registrations and the per-frame reads.
- `src/audio.ts` — the fifteen cues on the engine's cue bus, each declared as
  a synth fallback and then loaded from its produced file, and the two loops
  reconciled from the state every frame.
- `src/assets.ts` — the produced sprites through the engine's loader, held in
  a module table the renderer reads; a load that fails leaves a code-drawn
  stand-in.
- `src/render/` — the palette, the drawing helpers, the world under the
  camera, the effects over each hitbox, the HUD, the screens, and the
  almanac.
- `src/main.ts` — the fixed entry point (supplied with the project).

Tests sit beside what they test as `src/**/*.test.ts` and run in Node with no
browser: the simulation over drafts, the surface over states, the renderer
over an `@napi-rs/canvas` canvas, and `src/engine.test.ts`, which stands a
real engine up over that canvas and a `ConstantClock` and drives it with
dispatched keyboard and pointer events and poses through `engine.apply`.

## The art and the sound

Every sprite, sheet, icon, and sound the game shows or plays was produced
once with the asset tools and committed under `assets/`; the build bundles
those files and invokes no tool. `ASSET-LAYOUT.md` maps every file to the
code that draws or plays it. To regenerate them, with the tools on the `PATH`
(or built under `$CARGO_TARGET_DIR`):

```sh
node scripts/gen-sprites.mjs   # every sprite, sheet, and icon (draw, draw-sheet)
bash scripts/gen-audio.sh      # the cues, the hum, and the bed (sfx-synth, music)
```

## Debugging and automation

`initialize` returns the debug surface beside the state, and the engine hands
it back from `engine.debug`; nothing is installed on the page. A caller poses
the game through `engine.apply((s) => engine.debug.setHp(s, 40))`, steps it
off real time with `engine.advance` under a `ConstantClock` of `1000 / 60`
milliseconds, one tick per frame on `playing`, and reads it back with
`engine.debug.snapshot(engine.state)`. The overlay on `Backquote` shows the
live diagnostics.
