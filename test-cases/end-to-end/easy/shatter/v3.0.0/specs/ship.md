# Shatter — The ship

This file defines the ship the player flies: its geometry and how it handles under
momentum. What it shoots is in `specs/weapons.md`, the lives it is flown through
are in `specs/progression.md`, and the keys that drive it are in
`specs/controls.md`.

## Geometry

The ship is drawn as a triangle pointing along its current facing, roughly `34`
long from nose to tail and `26` wide at the tail. It collides as a circle of
radius `SHIP_R` (`14`) centred on its position.

The ship carries a facing angle and a velocity. It has no reverse and no brake:
speed is killed by turning around and thrusting against the motion, or by letting
the drag bleed it off.

## Inertial flight

Each tick, in this order, the ship's facing turns, its thrust is applied, its drag
is applied, and its speed is capped.

| Step | Rule |
| --- | --- |
| Rotation | While a turn key is held the facing rotates at a constant `SHIP_TURN` (`300` degrees per second): the left key turns counter-clockwise, the right key clockwise. Rotation changes the facing alone and never the velocity. |
| Thrust | While the thrust key is held, an acceleration of `SHIP_THRUST` (`480` units per second squared) is added along the current facing. There is no reverse thruster. |
| Drag | The velocity is multiplied by `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)` with `SHIP_DRAG_HALFLIFE` (`3.0` seconds), so an un-thrusting ship loses half its speed every `3.0` seconds of game time. |
| Speed cap | The speed is then clamped to `SHIP_MAX` (`680`). Thrust and carried momentum reach the cap but never pass it. |

The star never pulls the ship, so it flies exactly where the player steers it. The
ship wraps at the field's edges and carries its velocity across, as
`specs/field.md` states.

## The safe point

A life begins with the ship at rest at the safe point `(SAFE_X, SAFE_Y)` =
`(640, 560)`, directly below the star and clear of its core, facing `FACE_UP`
(`-90` degrees, straight up). `specs/progression.md` states when a life begins.

## The thrust flame

While thrust is being applied, a flame is drawn trailing from the ship's tail. It
is absent whenever thrust is not being applied.
