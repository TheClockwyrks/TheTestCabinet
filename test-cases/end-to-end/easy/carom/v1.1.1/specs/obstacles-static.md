# Carom — Obstacles

The two obstacles from `specs/playfield.md` are **fixed in place** and never move:
Obstacle A stays centered at `(490, 220)` and Obstacle B at `(790, 500)`.

## Collision

Treat each obstacle as an **axis-aligned rectangle** with half-extents
`(hw, hh) = (10, 70)` — the rounded corners are cosmetic — centered at its fixed
center. When the ball strikes an obstacle, reflect the velocity component normal
to the face it hit — a hit on a left/right (vertical) face flips `vx`, a hit on a
top/bottom (horizontal) face flips `vy` — then push the ball out of the obstacle
so it no longer overlaps.

**Speed is unchanged and spin is preserved** (see `specs/physics.md`); the spin
keeps curving the ball after the bounce. The ball must never tunnel through an
obstacle even at high speed; use swept collision or a small enough timestep, as
`specs/physics.md` requires.
