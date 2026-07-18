# Carom — Obstacles

The two obstacles from `specs/playfield.md` are fixed in place and never move.
Obstacle A stays centered at `(490, 220)` and Obstacle B at `(790, 500)`.

## Collision

Treat each obstacle as an axis-aligned rectangle with half-extents
`(hw, hh) = (10, 70)`, centered at its fixed center; the rounded corners are
cosmetic. When the ball strikes an obstacle, reflect the velocity component
normal to the face it hit, so a hit on a left or right (vertical) face flips `vx`
and a hit on a top or bottom (horizontal) face flips `vy`, then push the ball out
of the obstacle so it no longer overlaps.

An obstacle bounce leaves speed unchanged and preserves spin (see
`specs/physics.md`), so the spin keeps curving the ball after the bounce.
