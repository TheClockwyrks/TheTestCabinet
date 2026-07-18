# Carom — Obstacles

The two obstacles from `specs/playfield.md` are live: they sway up and down and
spin in place. A spinning obstacle presents a tilted face, so the ball bounces
off it at angles that have nothing to do with the axis-aligned walls, reflecting
off an oriented rectangle. Reading these moving, rotating obstacles to bank shots
is the heart of the game.

## Moving, rotating obstacles

Keep the two obstacles from `specs/playfield.md`, each a rounded bar 20 wide by
140 tall, with centers at `A = (490, 220)` and `B = (790, 500)`. Each obstacle's
pose is a function of an obstacle clock `t` (in seconds):

- Vertical oscillation. Each obstacle's center `x` is unchanged while its center
  `y` oscillates sinusoidally about its center with amplitude 80 px and period
  `3.6 s`. The two obstacles oscillate in anti-phase, so the layout stays
  point-symmetric about the field center `(640, 360)` and neither side is
  favored:
  - Obstacle A center: `(490, 220 + 80 * sin(2*pi * t / 3.6))`.
  - Obstacle B center: `(790, 500 - 80 * sin(2*pi * t / 3.6))`.
- Rotation. Each obstacle rotates continuously about its own center at a constant
  60 deg/s, in the same direction for both, with angle `theta(t) = 60 * t`
  degrees (taken mod 360). At `t = 0` both obstacles are upright (long axis
  vertical), so the field starts in the familiar layout and the motion grows from
  there.

At these values the obstacles stay clear of the top and bottom walls at all
times, even at full tilt, and the point-symmetry holds at every instant, so play
is balanced.

The obstacle clock `t` advances by `dt` on every physics step of a live match,
including during the pre-serve countdown, so the obstacles are already moving when
a ball is served. It is frozen while the game is paused, and it resets to `0` at
the start of each match, so every match opens with both obstacles upright at their
centers. The obstacle motion is driven from this simulation clock rather than
wall-clock time, keeping it reproducible on the fixed timestep from
`specs/physics.md`.

The obstacles are drawn rotated and shifted to match their current pose, in the
neon obstacle styling from `specs/overview.md`.

## Collision with oriented obstacles

Treat the ball as a circle of radius 11 and each obstacle as a rectangle with
half-extents `(hw, hh) = (10, 70)`, the rounded corners cosmetic, but that
rectangle is oriented at the obstacle's current angle `theta(t)` and centered at
its current center `C = (cx, cy)`.

Each physics step, after advancing the ball, resolve it against each obstacle at
that obstacle's current pose (`C`, `theta`):

1. Into the obstacle's local frame. Translate and un-rotate the ball center
   `P = (px, py)` into the obstacle's local axes (rotate by `-theta` about `C`):
   - `dx = px - cx`, `dy = py - cy`
   - `lx =  dx * cos(theta) + dy * sin(theta)`
   - `ly = -dx * sin(theta) + dy * cos(theta)`
   In this local frame the obstacle is an axis-aligned rectangle spanning
   `[-10, 10] x [-70, 70]`.
2. Closest point and overlap. Clamp to the rectangle:
   `qx = clamp(lx, -10, 10)`, `qy = clamp(ly, -70, 70)`. The ball overlaps the
   obstacle when the distance from `(lx, ly)` to `(qx, qy)` is less than the ball
   radius 11.
3. Local normal. If the ball center is outside the rectangle, the local contact
   normal is `normalize((lx - qx, ly - qy))`, a face normal for an edge hit and
   pointing out of a corner for a corner hit. If the ball center is inside the
   rectangle, use the axis of least penetration as the local normal (`+/-x` or
   `+/-y`).
4. Back to world. Rotate the local normal `(nlx, nly)` back by `+theta` to get the
   world normal `n`:
   - `nx = nlx * cos(theta) - nly * sin(theta)`
   - `ny = nlx * sin(theta) + nly * cos(theta)`
5. Reflect. If the ball is moving into the surface (`v . n < 0`), reflect the
   velocity about the world normal: `v' = v - 2 * (v . n) * n`. Speed is unchanged
   and spin is preserved (see `specs/physics.md`), so the spin keeps curving the
   ball after the bounce. Then push the ball out along `n` so it no longer
   overlaps, placing its center one radius off the contact face.

When `theta = 0` this reduces to the upright case: a hit on a vertical face flips
`vx` and a hit on a horizontal face flips `vy`. At any other angle the ball leaves
along the reflected direction off the tilted face, which is the distinctive
challenge of the game.

An obstacle's own motion changes only where and at what angle the ball is struck,
never its speed or spin, both of which are governed solely by `specs/physics.md`.
