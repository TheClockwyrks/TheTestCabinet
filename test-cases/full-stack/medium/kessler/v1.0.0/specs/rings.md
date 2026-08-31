# Kessler — The rings

This file fixes the three rings of derelict targets: their slots and arcs,
target hit points, the orbits, the contacts a ball makes with a target, what a
hit and a destruction do, and the waves. The rings' radii and contact radii
are in `specs/field.md`, and the reflection pipeline a hit resolves through is
in `specs/deflector-and-ball.md`.

## The rings and their targets

Each ring is an annulus of slots, and each slot holds one derelict target. A
ring is positioned by one angle in degrees, its ring angle.

| Ring | Slots | Slot width | Target arc | Hit points | Orbit speed at wave `w` |
| --- | --- | --- | --- | --- | --- |
| 1 | `12` | `30` degrees | `26` degrees | `1` | `0` (stationary) |
| 2 | `16` | `22.5` degrees | `18.5` degrees | `2` | `+min(12 + 3 * (w - 1), 45)` degrees per second |
| 3 | `20` | `18` degrees | `14` degrees | `1` | `-min(8 + 2 * (w - 1), 30)` degrees per second |

Slot `k` of a ring, with `k` running from `0` to the slot count minus one,
begins at the ring's angle plus `k` times the slot width. The slot's target
arc begins `2` degrees into the slot and spans the target arc width, leaving a
structural gap of `2` degrees at each side of the slot.

Every slot is filled at the start of a wave. Each hit removes one hit point,
and a target whose hit points reach zero is destroyed. A ring 2 target that
has taken a hit is drawn visibly distinct from an undamaged one, so a player
reads its state at a glance.

## Orbits

Each ring's angle advances by its orbit speed in step 2 of the tick order,
positive speeds toward `+theta` and negative speeds toward `-theta`. Ring
angles wrap modulo `360`. Every ring starts a session, and starts each wave,
at ring angle `0`.

## Ball contacts

A ball contacts a target through two crossing events, both decided against
the target arcs as this tick's ring advance posed them.

- Face: in a tick where the ball's center radius crosses a ring's contact
  radius toward the ring, from above the outer contact radius to on or below
  it, or from below the inner contact radius to on or above it, and the
  ball's center angle is within a live target's arc, the ball scores a face
  hit on that target.
- Edge: in a tick where the ball's center radius lies between a ring's inner
  and outer contact radii, and the ball's center angle crosses into a live
  target's arc, the ball scores an edge hit on that target. The crossing is
  relative: the ball's motion, the ring's rotation, or both may produce it.

A tick where the same target takes both a face and an edge crossing resolves
as the face hit. These are the only target contacts, so a ball whose center
angle stays inside a structural gap crosses the ring untouched. A crossing is
an event, so a contact repeats only after a fresh crossing.

A face hit reflects the ball as a face contact and an edge hit as an edge
contact, through the reflection pipeline in `specs/deflector-and-ball.md`,
with the ring kick applying when the target's ring is moving. Each hit, face
or edge, removes one hit point and awards points as `specs/scoring.md` fixes.
The pierce effect in `specs/pods.md` changes what a target contact does while
it is in force.

## Hits and destruction

A hit that leaves the target's hit points above zero plays the `target-hit`
cue. A hit that brings them to zero destroys the target: the target is
removed, the destruction burst particle system spawns at the target's arc
center as posed that tick, the `target-break` cue plays, the ring's destroy
score is awarded as `specs/scoring.md` fixes, and the salvage pod draw in
`specs/pods.md` runs. A hit plays exactly one of the two cues.

## Waves

A session starts at wave `1`, and waves continue without limit. The wave
number sets the ball speed in `specs/deflector-and-ball.md` and the orbit
speeds above.

Clearing a wave is an event: a hit from a ball destroys a target and leaves
zero live targets across all three rings. At that instant every ball, every
pod, every timed effect, and the shield are removed, with no life lost, the
`wave-clear` cue plays, and the `waveclear` interstitial begins. The
wave-clear bonus in `specs/scoring.md` is awarded for the event.

The interstitial runs its course on the `waveclear` screen, as
`specs/screens.md` fixes. When it ends, every slot of every ring refills with
a full-hit-point target, ring angles reset to `0`, the wave number rises by
one, the new wave's ball speed and orbit speeds apply, and a ball parks on the
deflector.
