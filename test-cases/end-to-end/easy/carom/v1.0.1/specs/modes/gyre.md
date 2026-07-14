# Carom — Gyre mode

This file defines the **Gyre** mode, which sits alongside the standard modes. It
builds on the standard modes in `specs/modes/standard.md`, the geometry in
`specs/playfield.md`, the physics in `specs/physics.md`, and the match flow in
`specs/flow.md`.

In Gyre the two obstacles are no longer fixed: they **sway up and down and spin**
in place. Because a spinning obstacle presents a tilted face, the ball bounces
off it at angles that have nothing to do with the axis-aligned walls — the
collision must reflect off an **oriented** rectangle, not the axis-aligned one
the standard modes assume. This is the whole point of the mode, and the reason it
is harder than the others.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `GYRE`

Place it after the standard `SOLO` and `VERSUS` entries and before `HOW TO PLAY`.

## Mode

- **Gyre** — same as **Solo** (human on the left versus the AI on the right,
  single ball, normal `1.04` speed multiplier with the `980 px/s` cap, the same
  serve and scoring, the same AI opponent from `specs/modes/standard.md`, and the
  same spin mechanic from `specs/physics.md`), **except the two obstacles move**:
  each obstacle oscillates vertically and rotates continuously about its own
  center, as defined below.

Only the obstacles change. The paddles, ball, walls, goals, scoring, and the
paddle bounce-and-spin mechanic are all exactly as in Solo. The mode label shown
in the HUD (see `specs/flow.md`) during a Gyre match is `GYRE`.

## Moving, rotating obstacles

For the Gyre mode, the obstacles are **live**. `specs/playfield.md` and
`specs/flow.md` already leave obstacle motion to the mode spec; this section
supplies that motion, and it **overrides** the axis-aligned obstacle collision
treatment in `specs/physics.md` (the obstacles rotate, so the ball reflects off
oriented faces). Everything else in those files still applies unchanged.

Keep the two obstacles from `specs/playfield.md` — each a rounded bar **20 wide
x 140 tall**, with **base centers** at `A = (490, 220)` and `B = (790, 500)`. In
Gyre, each obstacle's pose is a function of an **obstacle clock** `t` (in
seconds):

- **Vertical oscillation.** Each obstacle's center `x` is unchanged; its center
  `y` oscillates sinusoidally about its base center `y` with **amplitude 80 px**
  and **period 3.6 s**. The two obstacles oscillate in **anti-phase** so the
  layout stays point-symmetric about the field center `(640, 360)` and neither
  side is favored:
  - Obstacle A center: `(490, 220 + 80 * sin(2*pi * t / 3.6))`.
  - Obstacle B center: `(790, 500 - 80 * sin(2*pi * t / 3.6))`.
- **Rotation.** Each obstacle rotates continuously about its own center at a
  constant **60 deg/s**, in the same direction for both, with angle
  `theta(t) = 60 * t` degrees (taken mod 360). At `t = 0` both obstacles are
  upright (long axis vertical), so the field starts in the familiar static
  layout and the motion grows from there.

With these values the obstacles stay clear of the top and bottom walls at all
times (even at full tilt their swept extent stays inside the field), and the
point-symmetry holds at every instant, so the mode is balanced.

The **obstacle clock** `t` advances by `dt` on every physics step of a live match
— including during the pre-serve countdown, so the obstacles are already moving
when the ball is served. It is **frozen while the game is paused**, and resets to
`0` at the start of each match (so every match opens with both obstacles upright
at their base centers). Drive the obstacle motion from this simulation clock, not
from wall-clock time, so the behavior stays reproducible on the fixed timestep
from `specs/physics.md`.

The obstacles are drawn rotated and shifted to match their current pose, with the
same neon obstacle styling as the standard modes.

## Collision with oriented obstacles

This **replaces** the obstacle case of the Collision section in
`specs/physics.md` (the axis-aligned "side hit flips `vx`, top/bottom hit flips
`vy`" rule) for the Gyre mode. Wall and paddle collisions are unchanged; only the
obstacle collision becomes orientation-aware. As before, treat the ball as a
circle of **radius 11** and each obstacle as a **rectangle** with half-extents
`(hw, hh) = (10, 70)` — the rounded corners are cosmetic — but now that rectangle
is **oriented** at the obstacle's current angle `theta(t)` and centered at its
current center `C = (cx, cy)`.

Each physics step, after advancing the ball, resolve it against each obstacle at
that obstacle's **current pose** (`C`, `theta`):

1. **Into the obstacle's local frame.** Translate and un-rotate the ball center
   `P = (px, py)` into the obstacle's local axes (rotate by `-theta` about `C`):
   - `dx = px - cx`, `dy = py - cy`
   - `lx =  dx * cos(theta) + dy * sin(theta)`
   - `ly = -dx * sin(theta) + dy * cos(theta)`
   In this local frame the obstacle is an axis-aligned rectangle spanning
   `[-10, 10] x [-70, 70]`.
2. **Closest point and overlap.** Clamp to the rectangle:
   `qx = clamp(lx, -10, 10)`, `qy = clamp(ly, -70, 70)`. The ball overlaps the
   obstacle when the distance from `(lx, ly)` to `(qx, qy)` is less than the ball
   radius `11`.
3. **Local normal.** If the ball center is outside the rectangle, the local
   contact normal is `normalize((lx - qx, ly - qy))` — this is a face normal for
   an edge hit and points out of a corner for a corner hit. If the ball center is
   **inside** the rectangle, use the axis of **least penetration** as the local
   normal (`+/-x` or `+/-y`), exactly as the axis-aligned rule does when resolving
   a deep overlap.
4. **Back to world.** Rotate the local normal `(nlx, nly)` back by `+theta` to get
   the world normal `n`:
   - `nx = nlx * cos(theta) - nly * sin(theta)`
   - `ny = nlx * sin(theta) + nly * cos(theta)`
5. **Reflect.** If the ball is moving into the surface (`v . n < 0`), reflect the
   velocity about the world normal: `v' = v - 2 * (v . n) * n`. **Speed is
   unchanged and spin is preserved**, exactly as for a static obstacle in
   `specs/physics.md`; the spin keeps curving the ball after the bounce. Then push
   the ball out along `n` so it no longer overlaps (place its center one radius
   off the contact face).

When `theta = 0` this reduces exactly to the axis-aligned rule from
`specs/physics.md`: a hit on a vertical face flips `vx`, a hit on a horizontal
face flips `vy`. At any other angle the ball leaves along the **reflected**
direction off the tilted face, which is the added challenge of this mode.

Because the obstacles move and spin while the ball travels, the no-tunneling
requirement from `specs/physics.md` is sharper here: keep the fixed timestep small
(the `120 Hz` from `specs/physics.md` is a reasonable baseline) and, if needed,
sub-step the ball, sampling each obstacle's pose at the sub-step's time so a fast
ball cannot pass through a thin, tilted obstacle. The ball's speed and spin are
governed solely by the rules in `specs/physics.md` — the obstacle's own motion
changes only *where* and *at what angle* the ball is struck, never its speed.
