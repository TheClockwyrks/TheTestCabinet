# Carom — Physics, collision, and the spin mechanic

This file defines how the ball moves and interacts with the field. It builds on
the geometry in `specs/playfield.md` and the coordinate system in
`specs/overview.md`.

## Physics

Run the simulation on a fixed timestep of 120 Hz — a step of exactly 1/120 of a
second — decoupled from rendering and integrating positions each step. The rate
is fixed rather than a suggestion, because `specs/instrumentation.md` advances the
simulation in whole ticks of it. The core is render-free: state
advances purely by stepping the simulation, with no dependence on the canvas or
on wall-clock time, and rendering only reads the state. Any randomness runs off a
seedable generator. These properties let the game be stepped and reproduced from
code, which `specs/instrumentation.md` relies on to drive and inspect it.

Each step, for the ball:

1. Apply the spin acceleration (below) to the velocity.
2. Advance position by `velocity * dt`.
3. Resolve collisions with walls, paddles, and obstacles.

## Collision

Resolve the ball against the top and bottom walls, the two paddles, and the two
obstacles. Treat the ball as a circle and each paddle as an axis-aligned
rectangle.

- Top and bottom wall: reflect the vertical velocity (`vy -> -vy`) and push the
  ball back inside the field. Speed is unchanged.
- Obstacle: resolve the ball against the two obstacles as `specs/obstacles.md`
  defines. An obstacle bounce leaves speed unchanged and preserves spin, so the
  spin keeps curving the ball after the bounce.
- Paddle: see the next section. A paddle hit is the only collision that changes
  speed and imparts spin.

The ball never passes through a paddle, wall, or obstacle, even at high speed.

## Paddle bounce and spin

When the ball strikes a paddle:

1. Reflection angle from contact point. Let
   `offset = (ballCenterY - paddleCenterY) / 55`, clamped to `[-1, 1]` (55 is the
   paddle half-height). The outgoing angle from horizontal is
   `theta = offset * 55deg`. Hitting the paddle center sends the ball straight
   across; hitting the top or bottom edge sends it off at up to 55deg.

2. Speed. `speed = min(speed * 1.04, 980)`. The horizontal direction flips to
   point toward the opposing goal, giving new velocity
   `vx = +/- speed * cos(theta)` (sign toward the opponent) and
   `vy = speed * sin(theta)`.

3. Spin from paddle motion. The paddle's vertical velocity at contact adds spin:
   `spin += paddleVy * 0.85`, then clamp `spin` to `[-900, 900]`. A paddle moving
   downward as it strikes curves the ball one way, a paddle moving upward curves
   it the other, and a stationary paddle imparts no new spin.

Spin is a signed scalar carried by the ball. Each physics step it applies a
lateral acceleration perpendicular to the ball's direction of travel, of
magnitude `|spin|` (in px/s^2), curving the path toward the side determined by
the sign of `spin`. Spin decays toward zero exponentially, losing about half its
magnitude every `0.8 s` (`spin *= 0.5 ^ (dt / 0.8)` per step). It persists across
wall and obstacle bounces and changes only through paddle hits and decay.

A paddle swiped at the moment of contact bends the ball's flight, letting a
player curve shots around the obstacles or wrong-foot the opponent.
