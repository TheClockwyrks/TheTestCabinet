# Fathom — Movement, controls, and ink

This file defines how the forager moves through the maze, the controls, and the
**ink** defense. It builds on the tile grid in `specs/overview.md`, the maze in
`specs/playfield.md`, and the sensing systems in `specs/sensing.md`.

## Tile-locked movement

Run the simulation on a **fixed timestep** (for example 120 Hz) decoupled from
rendering, so movement and timing are reproducible; do not tie the simulation to
the render frame rate.

- The forager travels along the **center lines of corridors** at a constant
  **`128 px/s`** (4 tiles per second). It is always moving in one of the four
  cardinal directions, or stopped against a wall.
- **Turning happens at tile centers.** The player sets a *desired* direction (see
  Controls). The forager keeps moving in its current direction until reaching a
  tile center; there, if the desired direction leads into an **open** tile, it
  turns; otherwise it keeps going straight until it either can turn that way or
  reaches a wall and stops. A desired direction is **buffered**: hold or tap a
  direction slightly before a junction and the forager takes it at the junction.
- **Reversing** (turning to the opposite of the current direction) is allowed at
  any time, not only at tile centers.
- The forager moves continuously through a **wrap tunnel** (see
  `specs/playfield.md`), exiting one edge and entering the other without stopping.
- The forager can never enter a wall tile or the **den** (`specs/playfield.md`).
- **Render it from the provided forager sprite** (`assets/glimmerfin/`, see
  `specs/assets.md`): draw the frame pair for its current facing and alternate the
  two while moving so it reads as chomping along the corridor. Do not draw a
  substitute forager.

The predators move on the same grid and at their own speeds; their movement and
turning rules are in `specs/predators.md`.

## Controls

Keyboard only.

- **Move:** `Arrow keys` **or** `W` `A` `S` `D` set the desired direction.
- **Sonar pulse:** `Space` emits a pulse when it is off cooldown (see
  `specs/sensing.md`).
- **Ink:** `Shift` (either) releases an ink cloud when it is off cooldown (below).
- **Pause:** `Esc` or `P`.
- **Menus / pause / game-over:** `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, `Esc` goes back.

## Ink — blinding the hunters that see

Ink is your defense against the predators that hunt by **sight**.

- **Trigger and cooldown.** Pressing the ink key releases a cloud when ink is off
  its **`8 s`** cooldown. Ink is **unlimited** — only the cooldown limits it. The
  HUD shows an ink readiness gauge (see `specs/playfield.md`).
- **The cloud.** A dark ink cloud appears centered on the forager, about **`80 px`**
  (2.5 tiles) in radius, and lingers for **`3 s`** before dissipating. It is fixed
  where it was released (it does not follow the forager) and it neither blocks nor
  slows anyone — it is a screen of darkness, not a wall.
- **Effect — blinds sight-based predators.** A predator that hunts by sight — the
  **Lure** and the **Flarefish** (see `specs/predators.md`) — that is inside the
  cloud, or whose line to the forager passes through it, is **blinded**: it
  immediately loses any fix it has on you and cannot see, acquire, or track you
  while blinded by the cloud. Blinded, it falls back to drifting/patrolling until
  the cloud clears or it leaves the cloud.
- **No effect on the Listener.** The **Listener** hunts by sound, not sight, so
  ink does nothing to it. You cannot ink your way past the Listener — you have to
  out-maneuver it (see the juke in `specs/predators.md`).

Ink is the counter to the two seeing predators; the Listener is the one you must
lose by movement. Spend ink to break a chase or to cross open ground unseen, but
mind the cooldown.
