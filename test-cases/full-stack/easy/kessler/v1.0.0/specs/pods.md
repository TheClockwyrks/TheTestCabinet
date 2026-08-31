# Kessler — Salvage pods and effects

This file fixes the draw that decides whether a destroyed derelict sheds a
salvage pod, the pod's flight with its catch and burn-up, and the five pod
kinds with their exact effects and durations. Destruction itself is in
`specs/rings.md`, the deflector and its span are in
`specs/deflector-and-ball.md`, the points a catch awards are in
`specs/scoring.md`, and the pod sprites are produced files `specs/assets.md`
lists. Durations are whole ticks of the fixed timestep `specs/overview.md` fixes.

## The pod draw

The game keeps one random stream for the whole session: a mulberry32 generator
seeded with the session's seed. A fresh session seeds it with `DEFAULT_SEED`
(`1`), and pod draws are the only thing that consumes it. Each draw takes the
stream's next value, a number in `[0, 1)`, so the same seed and the same play
shed the same pods in the same order.

Each destruction runs the draw at the moment it resolves, so a tick that
destroys several targets draws once per destruction, in resolution order. The
destruction takes the stream's next value `u1`. At `u1 < 0.25` it sheds a pod
and takes a second value `u2` for the kind; at `u1 >= 0.25` it sheds nothing
and the draw ends there.

| `u2` | Kind |
| --- | --- |
| `[0, 0.25)` | `widen` |
| `[0.25, 0.45)` | `multiball` |
| `[0.45, 0.65)` | `shield` |
| `[0.65, 0.80)` | `pierce` |
| `[0.80, 1)` | `narrow` |

## Flight

A shed pod spawns at its ring's mid radius, at the destroyed target's
arc-center angle as the ring stands posed on the destruction tick.

| Ring | Spawn radius |
| --- | --- |
| Ring 1 | `302` |
| Ring 2 | `372` |
| Ring 3 | `442` |

The pod falls radially inward at `120` units per second, its center angle
constant. In flight it passes through the shield ring, every target, and every
ball. Its flight ends at a catch or a burn-up.

## Catch and burn-up

A catch is a crossing event. In a tick where the pod's center radius moves
from `prev_r > 196` to `new_r <= 196` with its center angle within the
deflector's span, measured as `specs/field.md` fixes, the pod is caught. The
span the catch tests is the span in force that tick. The caught pod is
removed, the catch scores as `specs/scoring.md` fixes, the `pod-catch` cue
plays (`pod-catch-narrow` for a `narrow` pod), and the kind's effect applies.

In a tick where the pod's center radius reaches `new_r <= 78`, the pod burns
up: it is removed, the burn-up particle system plays at the pod, and the
`pod-burn` cue plays. A burn-up applies no effect.

## The five kinds

| Kind | On catch | Duration |
| --- | --- | --- |
| `widen` | The deflector's span becomes `72` degrees. | `600` ticks |
| `narrow` | The deflector's span becomes `30` degrees. | `600` ticks |
| `multiball` | Up to two balls launch. | Instant |
| `shield` | The shield ring appears. | Until it reflects a ball |
| `pierce` | Every ball pierces. | `360` ticks |

### Timed effects

`widen`, `narrow`, and `pierce` are timed: each runs a whole-tick timer that
starts at its duration and counts down by one on every tick the simulation
advances. Catching a kind already in force restarts its timer at the full
duration. When a timer reaches `0` the effect ends: an ended span effect
returns the span to its baseline, and an ended `pierce` returns every ball to
ordinary contacts.

`widen` and `narrow` replace each other. Catching one while the other is in
force ends the other on the spot and puts the caught kind in force with a full
timer. `pierce` is independent of both, so it runs alongside either span
effect.

### `multiball`

The catch launches up to two balls from radius `194` at the deflector's center
angle, at the current wave's ball speed. One heads `20` degrees to the
`+theta` side of the outward radial and the other `20` degrees to the
`-theta` side, and the `+theta` ball launches first. As many of the two launch
as the six-ball cap admits, and a parked ball stays parked. At the cap the
catch scores and launches nothing.

### `shield`

The catch raises the shield ring around the planet, drawn at the radius
`specs/field.md` fixes. While it is active, the first ball in spawn order
whose center radius moves from `prev_r > 100` to `new_r <= 100` in a tick is
reflected off the shield: the specular radial reflection and the orbital decay
of `specs/deflector-and-ball.md`, at the ball's incoming speed. The reflection
plays the `shield-reflect` cue and the impact spark particle system at the
contact, and the shield disappears on it, so one shield reflects one ball.
Catching a `shield` pod while a shield is active scores and changes nothing
else.

### `pierce`

While `pierce` is in force every ball pierces, balls served or launched during
it included. A piercing ball's target contact, face or edge, destroys the
target outright whatever its hit points, awards the destroy score alone, and
leaves the ball's velocity unchanged: no reflection, no ring kick, no orbital
decay. The destruction otherwise resolves exactly as `specs/rings.md` states,
so it plays its cue and particle, runs the pod draw, and can clear the wave.
The deflector, the shield ring, and the containment field reflect a piercing
ball exactly as they reflect any other.

## Lifecycle

Effects, the shield, and falling pods live inside a wave. On a life loss and
at the clearing event, every timed effect ends, the span returns to its
baseline, the shield disappears, and every falling pod is removed. The moments
those two resolve are fixed in `specs/deflector-and-ball.md` and
`specs/rings.md`.
