# Wick

A survival game of one lamplighter against the night, built on the Structured
2D engine and running entirely in the browser. The lamplighter is alone in a
moth-choked city, and everything in the dark is drawn to the light. The player
only moves; the lamplighter's tools fire on their own, each on its own rhythm,
and what the player decides is where to stand and what to take at each
level-up. The night lasts ten minutes: reach dawn and the run is won, run out
of health and the lamplighter has fallen.

The game is written inside `@test-cabinet/structured-2d`'s framework: a game
instance, one game mode, a lamplighter pawn and the player controller that
drives it, and the tagged actors and draw components that populate the night.
The engine owns the frame loop, the canvas fit, rendering and the camera that
follows the lamplighter, the keyboard actions, the audio cue bus with its two
loops, asset loading, and the debug overlay. Every contact is the simulation's
own circle and rectangle math over the world's game state. There is no
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
served as-is, from the root of a static file server or mounted under a
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

| Action | Keys | Does |
| --- | --- | --- |
| Move | `ArrowUp` / `KeyW`, `ArrowDown` / `KeyS`, `ArrowLeft` / `KeyA`, `ArrowRight` / `KeyD` (held) | Moves the lamplighter; up and down also move a menu highlight |
| Confirm | `Enter` / `Space` | Accepts the highlighted item; closes the chest overlay |
| Back | `Escape` | Leaves the how-to screen; abandons a paused run; returns to the title from an end screen |
| Pause | `KeyP` | Pauses the night; resumes it |
| Mute | `KeyM` | Toggles sound, on every screen |
| Diagnostics | `` ` `` (backquote) | Shows and hides the engine's debug overlay, which lists the values the game registers: the screen, the clock, the loadout, the switches, and the mute bit |

## The source, file by file

The rules live apart from the framework objects that run them: everything
under the first heading is arithmetic over the live game state and is
unit-tested in isolation; everything under the second is the engine-facing
half.

### The rules of the night

- `src/constants.ts`: every figure the specification fixes, in one place.
- `src/state.ts`: `WickState`, the world's live game state, the idle run, and
  a fresh run.
- `src/rng.ts`: the seeded generator whose whole state is `rngState`.
- `src/stats.ts`: the derived stats the passives feed.
- `src/sim/`: one tick of the night in the order the specification fixes:
  the timers, the lamplighter, the enemies, the weapons' firing and placement,
  the projectiles and zones and their hits, the drops, the spawn director,
  progression, and the two endings.
- `src/flow.ts`: the eight screens, the menus, the tick accumulator, and the
  cues each answers with.

### The engine-facing half

- `src/game.ts`: the game instance, the game mode, and the `GameDefinition`
  the engine drives; re-exports the state and the debug surface type.
- `src/controller.ts`: the player controller, the one seat the registered
  actions are read from.
- `src/input.ts`: the action registry, names and key bindings.
- `src/actors.ts`: the lamplighter pawn with its camera and mirrored sprite,
  the tagged actors that follow every enemy, projectile, zone, gem, pickup,
  and puff, the ground, the HUD and screen actors pinned to the camera target,
  and the reconciler that keeps the population mirroring the state.
- `src/render/`: the palette and layer table, the drawing helpers, the world's
  pictures, the effects over their hitboxes, the HUD, and the screens.
- `src/audio.ts`: the fifteen cues bound to the produced files, each with a
  synthesized fallback beneath it, and the two loops reconciled every frame.
- `src/assets.ts`: loads the committed produced sprites; every load failure
  degrades to a code-drawn stand-in of the same size.
- `src/debug.ts`: the debug surface `initialize` returns: pure reads and
  loud-validating poses over the live world.
- `src/diagnostics.ts`: the named, read-only sources the engine's overlay
  reports.
- `src/main.ts`: the fixed entry point, supplied with the project.

Tests sit beside what they test as `src/**/*.test.ts` and run in Node with no
browser: the simulation and flow suites over the bare state, and the engine,
debug, and diagnostics suites over a real engine stood up on an
`@napi-rs/canvas` canvas with a `ConstantClock`, driven by `engine.advance`
(`src/harness.ts`).

## The art and the sound

Wick ships no pre-made art or audio. Every sprite, sheet, icon, and sound the
game shows or plays was produced once with the asset tools and committed under
`assets/`; the build bundles those files (served through `public/assets`) and
invokes no tool, so the project builds wherever the tools are absent.
`ASSET-LAYOUT.md` maps every file to the code that draws or plays it. To
regenerate them, with the tools on the `PATH` (or built under
`$CARGO_TARGET_DIR`):

```sh
node scripts/gen-sprites.mjs   # the lamplighter, enemies, effects, icons, ground (draw, draw-sheet)
bash scripts/gen-audio.sh      # the fourteen cues, the hum, and the music bed (sfx-synth, music)
```

The sprite script composes each sprite as a pixel raster under
`scripts/sprites/` and hands it to the tool as the operations that reproduce
it, so each committed PNG is the tool's own render of its recorded log. The
audio script builds each cue from oscillator and noise voices and sequences
the bed on synth-waveform tracks; the two loops are authored to run end into
start, and `src/assets.test.ts` reads every file back to check it.

## The debug surface

The game instance's `initialize` returns the debugging and automation surface
`specs/instrumentation.md` describes, and the engine returns it from
`engine.debug`: `snapshot()` reads the whole state as plain data, and every
other operation poses one part of the live game and sounds nothing. A
scenario pairs it with a `ConstantClock` of one tick per frame and
`engine.advance`, exactly as the build's own engine tests do.
