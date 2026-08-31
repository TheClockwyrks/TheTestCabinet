# Kessler — The deflector and the ball

This file fixes the deflector's motion, serving and launching, the ball's
motion and speed, the deflector bounce, and the reflection pipeline every
other surface resolves through. The geometry, contact radii, and angular
conventions it builds on are in `specs/field.md`. The target contacts that
feed the pipeline are in `specs/rings.md`, and the shield contact is in
`specs/pods.md`.

## The deflector

The deflector rides the deflector track and is defined by two figures: its
center angle in degrees and its span in degrees. Its baseline span is the
deflector span `specs/field.md` fixes, and the effects in `specs/pods.md` are
what change it. A session starts the deflector at center angle `90`.

While `ArrowLeft` or `KeyA` is held, the center angle falls at `270` degrees
per second; while `ArrowRight` or `KeyD` is held, it rises at `270` degrees
per second. The angle wraps modulo `360`, so the deflector circles the track
without limit in either direction.

## Serving

A parked ball sits at radius `194` at the deflector's center angle and follows
the deflector as it moves. At most one ball is parked at a time. A parked ball
is live: it counts toward the ball cap and is drawn like any other ball.

Pressing `Space` launches the parked ball radially outward at the current
wave's ball speed. A ball parks when a session starts, when a wave begins, and
after a life loss that leaves lives remaining.

## Ball motion

A ball travels in a straight line between contacts. Its speed changes at
exactly two moments: a launch serves it at the current wave's ball speed, and
a deflector bounce sets it to the current wave's ball speed. Every other
reflection preserves the speed the ball arrived with.

The ball speed of wave `w` is `240 + 30 * (w - 1)` units per second, capped at
`480`. At most `6` balls are in play at once, the parked ball included. Balls
pass through other balls and through pods.

## The deflector bounce

The deflector's one ball contact is a crossing event. In a tick where a ball's
center radius moves from above `194` to `194` or below, with inward radial
velocity (`v . n < 0`), and the ball's center angle is within the deflector's
span, the ball bounces off the deflector.

The bounce resolves these four steps, in this order, on the ball's velocity
`v`.

1. Specular: `v' = v - 2 (v . n) n`, with `n` the outward unit radial at the
   ball's center.
2. English: rotate `v'` by `1.2 * offset` degrees, where `offset` is the
   signed wrap-aware angular offset in degrees of the ball's center from the
   deflector's center angle, positive toward `+theta`.
3. Clamp: let `a` be the signed angle from `n` to the rotated velocity. The
   outgoing direction uses `a` clamped to `[-60, +60]` degrees, sign
   preserved.
4. Speed: the outgoing speed is set to the current wave's ball speed.

The bounce plays the `paddle-bounce` cue and spawns the impact spark particle
system at the contact.

## Reflections off every other surface

A target face hit, a target edge hit, the shield, and the containment field
all resolve through this pipeline, in this order, on the ball's velocity `v`.

1. Specular, by surface type. A face contact reflects the radial component:
   `v' = v - 2 (v . n) n`. An edge contact reflects the tangential component:
   `v' = v - 2 (v . t) t`. The shield and the containment field are face
   contacts.
2. Ring kick, only for a contact with a target in a moving ring: add
   `0.5 * u`, where `u` is the ring's surface velocity at the ball, tangential
   in the ring's direction of motion with magnitude equal to the ring's
   angular speed in radians per second times the ball's center radius.
3. Renormalize the speed to the speed the ball arrived with.
4. Orbital decay: rotate the velocity toward the local radial axis by
   `min(6, |phi|)` degrees, where `phi` is the signed angle from the nearer
   radial direction, outward or inward, to the velocity. The rotation reduces
   `|phi|`.

## Reflect in place

Every reflection in the game, the deflector bounce included, changes velocity
only. The ball keeps the position its advance gave it this tick.
