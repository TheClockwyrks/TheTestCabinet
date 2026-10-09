# Carom — Physics, collision, and the spin mechanic

This file defines how the ball moves and interacts with the field. It builds on
the geometry in `specs/playfield.md` and the coordinate system in
`specs/overview.md`.

## Physics

Run the simulation on a **fixed timestep** (for example 120 Hz) decoupled from
rendering, integrating positions each step. A fixed timestep keeps behavior
reproducible and testable; do not tie physics to the rendering frame rate.

Each step, for the ball:

1. Apply the spin acceleration (below) to the velocity.
2. Advance position by `velocity * dt`.
3. Resolve collisions with walls, paddles, and obstacles.

## Collision

Resolve the ball against the top/bottom walls, the two paddles, and the two
obstacles. Treat the ball as a circle and each paddle/obstacle as an
axis-aligned rectangle. (A mode spec under `specs/modes/` may rotate the
obstacles; when it does, treat those obstacles as oriented rectangles and resolve
them as that mode spec describes, replacing the axis-aligned obstacle rule below.)

- **Top / bottom wall:** reflect the vertical velocity (`vy -> -vy`) and push
  the ball back inside the field. Speed is unchanged.
- **Obstacle:** reflect the velocity component normal to the face that was hit
  (a side hit flips `vx`; a top/bottom hit flips `vy`), and push the ball out of
  the obstacle. Speed is unchanged; **spin is preserved** and keeps curving the
  ball after the bounce. (If a mode rotates the obstacles, reflect about the face
  normal in the obstacle's current orientation instead, as that mode spec
  defines; speed and spin are still preserved.)
- **Paddle:** see the next section. A paddle hit is the only collision that
  changes speed and that imparts spin.

The ball must never tunnel through a paddle, wall, or obstacle at high speed; use
swept collision or a small enough timestep to prevent it.

## Paddle bounce and spin (signature mechanic)

When the ball strikes a paddle:

1. **Reflection angle from contact point.** Let
   `offset = (ballCenterY - paddleCenterY) / 55`, clamped to `[-1, 1]` (55 is the
   paddle half-height). The outgoing angle from horizontal is
   `theta = offset * 55deg`. Hitting the paddle center sends the ball straight
   across; hitting the top or bottom edge sends it off at up to 55deg.

2. **Speed.** `speed = min(speed * 1.04, 980)` (normal/versus). The horizontal
   direction flips to point toward the opposing goal.
   New velocity: `vx = +/- speed * cos(theta)` (sign toward the opponent),
   `vy = speed * sin(theta)`.

   Some modes override this speed rule; the active mode spec states its own
   multiplier and cap when it differs.

3. **Spin from paddle motion.** The paddle's vertical velocity at contact adds
   spin: `spin += paddleVy * 0.85`, then clamp `spin` to `[-900, 900]`. A paddle
   moving downward as it strikes curves the ball one way; moving upward curves it
   the other; a still paddle imparts no new spin.

**How spin curves the ball.** Spin is a signed scalar carried by the ball. Each
physics step it applies a lateral acceleration **perpendicular to the ball's
direction of travel**, of magnitude `|spin|` (in px/s^2), curving the path
toward the side determined by the sign of `spin`. Spin **decays** toward zero
exponentially with a time constant such that it loses about **half its
magnitude every 0.8 s** (`spin *= 0.5 ^ (dt / 0.8)` per step). Spin persists
across wall and obstacle bounces and is only changed by paddle hits and decay.

The result: a paddle swiped at the moment of contact bends the ball's flight,
letting a player curve shots around the obstacles or wrong-foot the opponent.
