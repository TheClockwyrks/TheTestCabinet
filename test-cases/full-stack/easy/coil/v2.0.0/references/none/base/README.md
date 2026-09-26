# Coil

A neon grid serpent, played in the browser. One snake threads a single
continuous path across a bordered grid, eating pellets that make it a cell
longer each time, until a wrong turn runs it into a wall or into its own body.

Coil's own idea is the combo. Pellets eaten in quick succession build a
multiplier that lapses the moment you dawdle, so the strong player is the one
who plans an efficient route from one pellet to the next rather than the one who
merely survives.

The game runs entirely in the browser on no engine and with no backend. The
frame loop, the canvas fit, the keyboard, the audio and the diagnostics overlay
are all part of this project.

## Install

```sh
npm ci
```

## Run it

```sh
npm run dev
```

Vite serves the game with hot reload and prints the address to open.

## Build it

```sh
npm run build
```

That type-checks the project and emits the complete static site into `dist/`,
with `index.html` at its root. Every URL the build emits is page-relative, so
`dist/` runs as-is at the root of a static host and under a sub-path alike.

```sh
npm run preview
```

serves that `dist/` for a final check.

## Controls

The game is played from the keyboard alone. Keys are named by their physical
`KeyboardEvent.code`, so the bindings hold whatever layout you type on.

| Action      | Keys                 | On the board          | On a menu                    |
| ----------- | -------------------- | --------------------- | ---------------------------- |
| Steer up    | `ArrowUp`, `KeyW`    | Turns the snake up    | Moves the highlight up       |
| Steer down  | `ArrowDown`, `KeyS`  | Turns the snake down  | Moves the highlight down     |
| Steer left  | `ArrowLeft`, `KeyA`  | Turns the snake left  | Nothing                      |
| Steer right | `ArrowRight`, `KeyD` | Turns the snake right | Nothing                      |
| Confirm     | `Enter`, `Space`     | Nothing               | Accepts the highlighted item |
| Back        | `Escape`             | Pauses the round      | Leaves the screen            |
| Pause       | `KeyP`               | Pauses the round      | Resumes, on the pause menu   |
| Mute        | `KeyM`               | Toggles sound         | Toggles sound                |

The backtick key (`Backquote`) shows and hides the diagnostics overlay.

A turn is buffered and takes effect on the next step, and the snake can only
turn across the way it is travelling, so it never doubles back on itself.

## The art and the sound

Coil ships no third-party art or audio. The snake's sprite set and the four
sounds are produced with the asset-generation tools and committed under
`assets/`, and the build bundles those committed files. It never runs the tools,
so the project builds wherever they are absent.

Regenerating them, when the tools are on the `PATH`:

```sh
bash scripts/gen-sprites.sh
bash scripts/gen-audio.sh
```

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run format      # Prettier, in check mode
npm test            # Vitest over src/**/*.test.ts, with coverage
```
