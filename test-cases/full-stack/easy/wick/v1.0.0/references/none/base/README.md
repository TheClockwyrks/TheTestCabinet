# Wick

A survival game of one lamplighter against the night, running entirely in the
browser on no engine. The lamplighter is alone in a moth-choked city, and
everything in the dark is drawn to the light. The player only moves; the
lamplighter's tools fire on their own, each on its own rhythm, and what the
player decides is where to stand and what to take at each level-up. The night
lasts ten minutes: reach dawn and the run is won, run out of health and the
lamplighter has fallen.

The game stands on no engine and no backend. The frame loop and its fixed
60 Hz tick, the canvas fit, the keyboard, the Web Audio layer with its two
looping cues, the asset loading, and the diagnostics overlay are all part of
this project, under `src/`. The produced sprites, icons, and sounds live under
`assets/` and are bundled by the build.

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

## The produced assets

Every sprite, sheet, icon, and sound the game shows or plays was produced
once with the asset tools and committed under `assets/`; the build bundles
those files and invokes no tool. `ASSET-LAYOUT.md` maps every file to the
code that draws it. To regenerate the image set, with `draw` and `draw-sheet`
on the `PATH` (or built under `$CARGO_TARGET_DIR`):

```sh
node scripts/gen-sprites.mjs   # the lamplighter, enemies, effects, icons, ground
```

The script composes each sprite as a pixel raster under `scripts/sprites/`
and hands it to the tool as the operations that reproduce it, so each
committed PNG is the tool's own render of its recorded log.

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
| Diagnostics | `` ` `` (backquote) | Shows and hides the debug overlay |

## The debug surface

Once the game has initialized it installs `window.__wick`, the debugging and
automation surface `specs/instrumentation.md` describes: `snapshot()` reads
the whole state, `setAutoStep(false)` takes the game off the wall clock, and
`step(ticks)` and `advance(seconds)` run frames by hand. Every other operation
poses one part of the game and sounds nothing.

## Layout

| Path | Holds |
| --- | --- |
| `src/main.ts` | The entry point: assets, audio, keyboard, diagnostics, the loop, the surface. |
| `src/constants.ts` | Every figure the specification fixes. |
| `src/state.ts` | The state's shape, the idle run, and a fresh run. |
| `src/game.ts` | The screens, the menus, the frame's update, and the cues. |
| `src/sim/` | The tick: the lamplighter, enemies, weapons, effects, drops, and progression. |
| `src/runtime.ts`, `src/viewport.ts`, `src/input.ts`, `src/audio.ts`, `src/assets.ts` | The runtime layer. |
| `src/render/` | The world under the camera, the effects over each hitbox, the HUD, and the screens. |
| `src/surface.ts`, `src/diagnostics.ts`, `src/overlay.ts` | The debug surface and the overlay. |
| `assets/` | The produced sprites, icons, and sounds; `ASSET-LAYOUT.md` maps them. |
| `scripts/` | The asset production scripts, run once by hand. |
