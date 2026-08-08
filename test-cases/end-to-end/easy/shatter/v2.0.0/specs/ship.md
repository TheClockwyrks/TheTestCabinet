# Shatter — The ship and its bullets

This file defines the ship you fly and the bullets it fires: their geometry, how
the ship handles under momentum, and how a bullet behaves once launched. The
simulation loop that advances them, the gravity well, and the collision rules are
in `specs/simulation.md`.

## The ship

- The ship is a triangle roughly 34 long (nose to tail) and 26 wide at the tail,
  drawn pointing in its current facing direction. It collides as a circle of radius
  14.
- The ship has a facing angle it rotates freely, and a velocity it carries under
  momentum. It has no reverse and no brake: you kill speed by turning around and
  thrusting against your motion, or by letting the gentle drag bleed it off.
- The ship starts each life at rest at the safe point `(640, 560)`, directly below
  the star and clear of its core, facing straight up (270 degrees).
- While thrusting, draw a flickering thrust flame (color `#ffd166`) trailing from
  the tail.

## Inertial flight

The ship flies under momentum.

- Rotation. While a turn key is held, the ship rotates at a constant 300
  degrees/second: the left key turns counter-clockwise, the right key clockwise.
  Rotation changes only the facing angle, never the velocity.
- Thrust. While the thrust key is held, add acceleration of 480 px/s^2 along the
  current facing direction. There is no reverse thruster and no brake.
- Drag. Apply a gentle drag so an un-thrusting ship coasts to a crawl: each step
  multiply the ship's velocity by `0.5 ^ (dt / 3.0)`, so it loses half its speed
  roughly every 3 seconds of coasting. The drag is deliberately weak, so the ship
  glides rather than stopping on a dime.
- Speed cap. Clamp the ship's speed to a maximum of 680 px/s, applied after thrust
  each step. Thrust and carried momentum can push the ship to this cap but never
  past it.

The ship carries its velocity through wraps and across states as normal. The star
never pulls the ship (`specs/simulation.md`), so it flies exactly where the player
steers it.

## The bullets

- The ship fires small round bullets of radius 3 (color `#f2f5f7`) from its nose.
- Muzzle velocity. A fired bullet's velocity is the ship's current velocity plus 520
  px/s along the ship's facing, so your own drift carries into your shots and a shot
  fired while moving is faster than one fired at rest. This launch speed is modest so
  a bullet spends enough time near the star for the gravity well to bend it
  noticeably.
- Lifetime. A bullet is removed 1.5 seconds after it is fired, which bounds its range
  even though it wraps. It is also removed when it reaches the star core (absorbed) or
  when it destroys a rock.
- On-screen limit. At most 4 of the ship's bullets exist at once. While 4 are live,
  firing does nothing until one expires.
- Fire rate. Successive shots are gated to one every 22 ticks (22/120 of a second,
  about 0.183 s), so holding or mashing fire tops out at about 5.5 shots per second.
- A bullet is pulled by gravity and wraps at the edges, like the other ballistic
  bodies (`specs/simulation.md`).

## The bullet motion trail

Behind every moving bullet, draw a fading tail that traces its recent path, so it
visibly bends as the star curves the shot. The trail is what makes a bullet's
curvature near the star legible at a glance.

- It reads as one continuous streak in the bullet color `#f2f5f7`, a smooth comet
  rather than a row of discrete dots.
- It tapers from the bullet: widest and brightest where it meets the bullet, then
  narrowing and fading smoothly to nothing at its oldest end.
- It spans a fixed slice of recent travel time — the last 18 ticks of motion (18/120
  of a second, 0.15 s) — so its length is proportional to the bullet's current speed:
  it stretches on a fast shot and shortens as a bullet slows.
- Across a screen wrap it follows the bullet to the opposite edge rather than
  smearing across the field.
