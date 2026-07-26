# Fathom — Movement and controls

This file defines how the forager moves through the maze and the controls. It builds
on the tile grid in `specs/overview.md`, the maze in `specs/maze.md`, and the
gameplay systems (sensing, the sonar pulse, and ink) in `specs/gameplay.md`.

## The fixed-step core

Run the simulation on a fixed timestep of `120 Hz` — one step is exactly `1/120 s` —
decoupled from rendering, so movement and timing are reproducible; do not tie the
simulation to the render frame rate. The rate is fixed, not a suggestion: the debug
API advances time in whole simulation ticks (`specs/instrumentation.md`), and a tick
is only a unit if every implementation agrees on how long one lasts. The core
advances by whole fixed steps and reads no canvas or wall-clock time to make
progress, so a given sequence of inputs and steps always reaches the same state. This
deterministic, steppable core is what `specs/instrumentation.md` drives; implement it
on the same footing as the game.

## Tile-locked movement

- The forager travels along the center lines of corridors at a constant `128 px/s`
  (4 tiles per second). It is always moving in one of the four cardinal directions,
  or stopped. Its motion is continuous, not tile-by-tile: it slides smoothly between
  centers, which serve only as the points where it may change direction.
- Turning happens at tile centers. The player sets a desired direction (see
  Controls). The forager keeps moving in its current direction until reaching a tile
  center; there, if the desired direction leads into an open tile, it turns;
  otherwise it keeps going straight until it can either turn that way or reaches a
  wall and stops. A desired direction is buffered: hold or tap a direction slightly
  before a junction and the forager takes it at the junction.
- Reversing (turning to the opposite of the current direction) is allowed at any
  time, not only at tile centers.
- The forager moves continuously through the wrap tunnel (see `specs/maze.md`),
  exiting one edge and entering the other without stopping.
- The forager can never enter a wall tile or the den (`specs/maze.md`).
- Render it from the provided forager sprite (`assets/glimmerfin/`, see
  `specs/assets.md`): draw the frame pair for its current facing and alternate the
  two while moving so it reads as chomping along the corridor. Do not draw a
  substitute forager.

The predators move on the same grid and at their own speeds; their movement and
turning rules are in `specs/predators.md`.

## Controls

Keyboard only.

- Move: arrow keys or `W` `A` `S` `D` set the desired direction.
- Sonar pulse: `Space` emits a pulse when it is off cooldown (see `specs/gameplay.md`).
- Ink: `Shift` (either) releases an ink cloud when it is off cooldown (see
  `specs/gameplay.md`).
- Pause: `Esc` or `P`.
- Menus, pause, and game-over: `Up`/`Down` (or `W`/`S`) move the selection, `Enter`
  or `Space` confirms, `Esc` goes back.
