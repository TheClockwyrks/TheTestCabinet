# Kessler — The field

This file fixes the field's geometry and every contact radius, the angular
conventions every rule reads angles by, the order a tick resolves in, the
containment field, and the planet. Positions are in the logical units and the
polar mapping of `specs/overview.md`. The deflector and the ball's reflections
are in `specs/deflector-and-ball.md`, and the rings are in `specs/rings.md`.

## Angular conventions

Every angular rule in this specification uses these conventions.

- Rotating a vector by `a` degrees maps `(x, y)` to
  `(x cos a - y sin a, x sin a + y cos a)`. Positive `a` rotates toward
  `+theta`.
- An angular offset or distance between two angles is wrap-aware, taken in
  `[-180, 180)`.
- Angular membership, a ball or pod being within the deflector's span or a
  target's arc, is decided by the center point of the ball or pod, compared by
  wrap-aware circular distance, with the boundaries inclusive.
- At a ball's center, `n` is the outward unit radial and `t` is the unit
  tangential, `n` rotated by `+90` degrees.

## Geometry

Every radius below is measured from the stage center to the center of the ball
or pod concerned. An annulus is the region between its two radii.

| Element | Figure |
| --- | --- |
| Planet | Disc at the stage center, radius `70`. |
| Ball burn-up threshold | Ball center radius `78` or less. |
| Pod burn-up threshold | Pod center radius `78` or less. |
| Shield ring | Circle of radius `92`, present while the shield is active; ball contact radius `100`, crossed inward. |
| Deflector track | Annulus from radius `170` to `186`. |
| Deflector ball contact | Radius `194`, crossed inward within the span. |
| Deflector pod catch | Radius `196`, crossed inward within the span. |
| Deflector span | `48` degrees at baseline, `24` to each side of its center angle. |
| Ring 1 | Annulus from `290` to `314`; contact radii `282` (inner) and `322` (outer). |
| Ring 2 | Annulus from `360` to `384`; contact radii `352` (inner) and `392` (outer). |
| Ring 3 | Annulus from `430` to `454`; contact radii `422` (inner) and `462` (outer). |
| Containment field | Circle of radius `480`; ball contact radius `472`, crossed outward. |
| Ball | Radius `8`, `16` across. |
| Pod | Radius `10`, `20` across. |

## The order a tick resolves in

A tick of the `playing` screen resolves these steps, in this order. Each
contact below is a crossing event, decided from the position a body held
before its advance this tick and the position the advance gave it.

| Step | What happens |
| --- | --- |
| 1 | Held input moves the deflector. |
| 2 | Each ring's angle advances by its orbit speed. |
| 3 | Every running effect timer falls by one tick. |
| 4 | Pods advance inward; catches and burn-ups resolve. |
| 5 | Balls advance and resolve their contacts, in the order the balls were spawned. |
| 6 | The life-loss check below runs. |

A destruction inside step 5 runs its salvage pod draw at once, so draws happen
in the order destructions resolve. `specs/pods.md` fixes the draw.

## The containment field

The containment field is the circle of radius `480` that encloses play, drawn
so its extent reads at a glance. In a tick where a ball's center radius moves
from below `472` to `472` or above with outward radial velocity
(`v . n > 0`), the ball reflects off the containment field. The reflection is
a face contact resolved by the reflection pipeline in
`specs/deflector-and-ball.md`, it plays the `field-bounce` cue, and it spawns
the impact spark particle system at the contact.

## The planet

The planet is the disc of radius `70` at the stage center. In a tick where a
ball's center radius reaches `78` or less, the ball burns up: it is removed,
the burn-up particle system spawns at it, and the `ball-lost` cue plays. A pod
whose center radius reaches `78` or less burns up the same way, as
`specs/pods.md` states.

## The life-loss check

After step 5, if this tick's burn-ups removed the last live ball, one life is
lost: `lives` falls by `1`, and every timed effect, the shield, and every pod
are cleared. With lives remaining, a new ball parks on the deflector as
`specs/deflector-and-ball.md` states. At zero lives the game moves to the
`gameover` screen.
