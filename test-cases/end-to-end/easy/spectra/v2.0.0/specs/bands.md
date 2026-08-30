# Spectra — The two bands

This file defines the two spectral bands and everything a band decides: what a shot
destroys, what the hull absorbs, what the flip costs, and what a spectral inversion
swaps.

## The bands

There are exactly two bands, `cyan` and `magenta`. Every drone, every bullet, and
the ship itself carries one of them, and there is no third value and no neutral
state.

The ship holds one band at a time. It starts each run on `cyan`, and the flip below
is the only thing that changes it.

## Effective band

Every drone and every bullet carries a stored band. What it reads and counts as is
its **effective band**: its stored band, taken as the opposite band once for each of
the following that holds.

- The entity is a Prism whose shell has been broken, so the layer now exposed is its
  core.
- A spectral inversion is active and the entity is a drone or an enemy bullet.

The two swaps compose as toggles rather than additively, so two of them cancel: a
Prism whose stored band is cyan, whose shell has been broken, under an active
inversion, reads cyan.

The ship's band and the player's bullets are never swapped. A player bullet's
effective band always equals its stored band, and the ship reads its own true band
through an inversion.

## Your shots: match to destroy

When one of the player's bullets contacts a drone, the two effective bands decide
the outcome, and nothing else does.

| Case | Outcome |
| --- | --- |
| The bullet's effective band equals the drone's | The drone's exposed layer is destroyed, and the bullet is consumed |
| The bullet's effective band is the opposite | The drone is not destroyed, and the bullet is consumed |

A mismatched shot destroys nothing and is consumed on contact rather than passing
through, under every mode. What else a mismatched shot does to the drone is the
mode's, and `specs/mode.md` states it.

`specs/drones.md` states which layer of a Prism is exposed, and the two windows in
which a Flux can and cannot be destroyed.

## Your band is your shield

The ship's current band is also its hull's shield. When an enemy bullet contacts the
ship, the enemy bullet's effective band against the ship's band decides the outcome.

| Case | Outcome |
| --- | --- |
| The same band as the ship's | The bullet is absorbed and leaves the roster, and the ship is unharmed |
| The opposite band | The ship is hit, and the bullet leaves the roster |

`specs/resonance.md` states what an absorbed bullet adds to the meter, and
`specs/progression.md` what a hit costs.

A drone's body is not filtered by the shield. Contact between the ship and any
drone's body, of either band and whatever the ship is tuned to, hits the ship.

## The flip

The flip action changes the ship's band to the opposite one.

- The change is instant: the ship holds the other band in the frame the action is
  delivered.
- The flip starts a fire lockout of `FLIP_LOCKOUT` (`0.30`) seconds, during which
  the ship cannot fire. `specs/ship.md` states the lockout's effect on the cannon.
- A bullet already in flight keeps the band it was fired with.

The flip is available on every screen the wave is live on, whatever the meter or the
lockout stands at, and a flip made during a lockout restarts it.

## The spectral inversion

A spectral inversion swaps what the field reads as. It is triggered by a diving
Prism reaching the bottom of the play field, which `specs/drones.md` states.

- While an inversion is active, every drone and every enemy bullet reads as the
  opposite of its stored band, by the effective-band rule above. Nothing about the
  ship, the player's bullets, or any stored band changes.
- An inversion lasts `INVERSION_TIME` (`5.0`) seconds from the moment it begins, and
  the game carries the seconds remaining.
- At most one inversion is active at a time. A fresh trigger while one is running
  sets the remaining time back to `INVERSION_TIME` rather than adding to it.
- When the remaining time reaches zero the inversion ends, and every entity reads as
  its stored band again.

`specs/ui.md` states the mark the field carries while an inversion is active.
