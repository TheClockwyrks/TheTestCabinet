# Spectra — The ship and its cannon

This file defines the resonator-fighter the player flies and the cannon it fires.
The lane it travels along is in `specs/field.md`, the band a shot carries and the
lockout a flip starts are in `specs/bands.md`, and the keys are in
`specs/controls.md`.

## The hull

The ship is drawn at a footprint of `SHIP_W` (`40`) by `SHIP_H` (`28`), centered on
its position, from the seeded fighter art `specs/assets.md` describes. Its contact
half-extent is `SHIP_HALF` (`15`).

The ship's current band is readable on the ship itself, and it always agrees with
the polarity indicator `specs/ui.md` states.

## Movement

The ship moves left and right only, along the lane `specs/field.md` fixes.

- It travels at `SHIP_SPEED` (`360`) units per second while a direction is held.
- It stops in the frame the direction is released, with no drift and no inertia.
- Its center `x` is clamped to `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`). A ship
  driven into a bound rests at that bound and does not wrap.
- Holding both directions at once leaves the ship where it stands.

## Firing

A shot is a player bullet, and it leaves the ship's nose.

- It appears centered on the ship's own center `x`, above `SHIP_Y`, at the nose of
  the hull.
- It travels straight up at `PLAYER_BULLET_SPEED` (`760`) units per second and is
  drawn `PLAYER_BULLET_W` (`4`) by `PLAYER_BULLET_H` (`16`), with a contact
  half-extent of `PLAYER_BULLET_HALF` (`6`).
- It carries the ship's band at the instant it is fired, fixed for the bullet's
  whole life.

## What blocks a shot

Firing is allowed only when all three of the following hold. Otherwise the fire
action adds nothing.

| Gate    | Rule                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| Cadence | The fire cooldown is at zero. A shot sets it to `FIRE_INTERVAL` (`0.16`) seconds, and it counts down with game time. |
| Cap     | Fewer than `MAX_PLAYER_BULLETS` (`3`) of the player's bullets are in flight.                                         |
| Lockout | The fire lockout is at zero. A flip sets it to `FLIP_LOCKOUT` (`0.30`) seconds, and it counts down with game time.   |

Holding the fire action repeats it at the cadence: a shot leaves every
`FIRE_INTERVAL` for as long as the action is held and the cap and the lockout allow
one.
