# Shatter — Physics, gravity, and collision

This file defines how everything moves and interacts. It builds on the
geometry in `specs/playfield.md` and the coordinate system in
`specs/overview.md`.

## Simulation loop

Run the simulation on a **fixed timestep** (for example 120 Hz) decoupled from
rendering, integrating positions each step. A fixed timestep keeps behavior
reproducible and testable; do not tie physics to the rendering frame rate.

Each step, for every dynamic body (the ship, each bullet, each rock, the saucer):

1. Apply the body's own control forces (ship thrust; saucer steering — see below).
2. Apply the **gravity acceleration** from the star (every bullet and every rock
   — not the ship or the saucer, both of which are powered craft).
3. Advance velocity, then position, by `dt`.
4. Wrap position across the field edges (`specs/playfield.md`).
5. Resolve collisions (below).

## Inertial flight (the ship)

The ship flies under momentum — this is the feel of the game, so get it right.

- **Rotation.** While a turn key is held the ship rotates at a constant **300
  degrees/second** (left key counter-clockwise, right key clockwise). Rotation
  changes only the facing angle, never the velocity directly.
- **Thrust.** While the thrust key is held, add acceleration of **480 px/s^2**
  along the current facing direction. There is no reverse thruster and no brake.
- **Drag.** Apply a gentle drag so an un-thrusting ship eventually coasts to a
  crawl: each step multiply the ship's velocity by `0.5 ^ (dt / 3.0)` (it loses
  half its speed roughly every 3 seconds of coasting). Drag is deliberately
  weak — the ship is meant to glide, not stop on a dime.
- **Speed cap.** Clamp the ship's speed to a maximum of **680 px/s** (apply after
  thrust each step). Thrust and carried momentum can push the ship to this cap,
  but never past it.

The ship carries its velocity through wraps and across states as normal.

## The gravity well (signature mechanic)

The star at `(640, 360)` pulls on **every bullet and every rock**. The ship and
the saucer are the two exceptions — both are powered craft with their own
thrusters, and neither is ever pulled (see "Why the ship is not pulled" below).

For each affected body, every step, add an acceleration toward the star:

```
d      = distance from the body's center to the star center (640, 360)
d_eff  = max(d, 90)                     # softening radius: never divide by less
a_mag  = MU / (d_eff * d_eff)           # MU = 4_500_000  (px^3 / s^2)
a      = a_mag toward the star center   # along the unit vector body -> star
```

- `MU = 4_500_000`. With the softening radius of `90`, the acceleration is
  **capped at about 556 px/s^2** (reached at `d <= 90`). Sample magnitudes: about
  `112 px/s^2` at `d = 200`, `312` at `d = 120`, `556` (the cap) at `d <= 90`. The
  softening only bounds the math near the center — it keeps the pull finite as a
  body nears the core rather than letting it blow up. The well is deliberately
  strong: bullets and rocks must **visibly** bend as they pass the star, not merely
  drift a few pixels off a straight line.
- The core (radius `30`, `specs/playfield.md`) is solid and impassable, but it is
  **not** lethal to the ship: a ship that reaches it slides along its surface
  rather than being destroyed (see Collision below).
- Gravity uses the body's **direct** vector to the star center, not a
  wrapped one: the star is a single physical point at the middle of the field,
  so a body near a corner is genuinely far from it and barely pulled.

### Why the ship is not pulled

Gravity acts only on bodies flying **ballistically** — bullets and rocks. The ship
and the saucer are powered craft whose thrusters hold them against the star, so
they fly where they are steered, unaffected by the well. This keeps flight under
the player's full control: the star shapes the *board* — curving your shots and
the rocks' paths — without ever wresting the ship out of your hands. (Any
self-propelled munition the mode spec `specs/mode.md` adds likewise holds its own
course and so, like the ship and saucer, is **not** pulled by the well.)

What the pull produces, and why it is the heart of the game:

- **Shots curve.** Because bullets are pulled, a shot fired near the star bends;
  a skilled player can **bend a bullet around the star** to hit a rock on the far
  side, or must lead a target whose path the star is curving. Firing across the
  center is a different problem than firing out near the edge.
- **Rocks orbit.** Rocks swing through the field on curved, wrapping paths rather
  than straight lines, so the board is always churning. A rock drawn into the core
  is recycled to the edge (`specs/playfield.md`), keeping the field populated.
- **The center stays busy.** The ship flies through the well freely, but the
  space around the star is the most crowded part of the board — rocks constantly
  curving through it and recycling from the edges — so diving into the middle to
  line up a shot is a real risk-versus-reward choice, just not a lethal one.

## Bullets

- **Muzzle velocity.** A fired bullet's velocity is the **ship's current velocity
  plus 520 px/s along the ship's facing** — so your own drift carries into your
  shots, and a shot fired while moving is faster than one fired at rest. This
  launch speed is deliberately modest so a bullet spends enough time near the star
  for the gravity well to bend it noticeably; a much faster bullet would fly
  almost straight through the well.
- **Lifetime.** A bullet is removed **1.5 seconds** after it is fired (this bounds
  its range even though it wraps). It is also removed when it reaches the star core
  (absorbed) or when it destroys a rock.
- **On-screen limit.** At most **4** of the ship's bullets exist at once.
  While 4 are live, firing does nothing until one expires.
- **Fire rate.** Successive shots are at least **0.18 seconds** apart, so holding
  or mashing fire cannot exceed roughly 5–6 shots per second.
- Bullets are pulled by gravity and wrap, exactly like the other bodies.

## Collision

Treat every body as a circle of the radius given in `specs/playfield.md` (ship
`14`, bullets `3`, rocks `46`/`26`/`14`, saucer `18`, star core `30`). Use the
shortest **wrapped** distance between centers when testing a pair, so bodies
touching across a wrap seam collide. To prevent tunnelling at high speed (a fast
bullet or a slingshot rock), use swept/continuous collision or a small enough
timestep that no body moves more than its own radius per step.

Resolve these interactions:

- **Bullet ↔ rock.** A bullet that hits a rock is removed. Whether that hit
  destroys the rock outright or only lowers the health of an armored rock is set by
  the mode spec `specs/mode.md`; on the hit that destroys the rock, the rock
  **splits** per `specs/playfield.md` (Large → two Medium, Medium → two Small,
  Small → nothing) and its **score** is awarded (`specs/flow.md`). Each
  fragment spawns at the destroyed rock's position and takes the parent's
  velocity **plus a split kick** of about **90 px/s** directed **perpendicular
  to the bullet's travel** — the two fragments kicked to opposite sides — so the
  angle of your shot fans the pieces apart. Fragments then obey gravity like any
  rock.
- **Bullet ↔ saucer.** The saucer is destroyed (score `200`, `specs/flow.md`) and
  the bullet is removed.
- **Bullet ↔ star core.** The bullet is absorbed and removed.
- **Rock ↔ star core.** The rock is destroyed and recycled per `specs/playfield.md`
  (a same-size replacement re-enters from off-screen; no score, count unchanged).
- **Ship ↔ rock, ship ↔ saucer, ship ↔ saucer bullet.** The ship is destroyed and
  the player loses a life (`specs/flow.md`), unless the ship is currently in its
  post-respawn invulnerability window, in which case it passes through unharmed
  (see `specs/flow.md`).
- **Ship ↔ star core.** The core is a **solid but non-lethal** obstacle for the
  ship: touching it never costs a life and never destroys the ship. Instead the
  ship **slides along the core** — on contact, push the ship's center back out to
  a distance of `core radius + ship radius` (= `44`) from the star center along
  the star→ship direction, and remove the component of its velocity into the
  core while keeping the tangential component, so it grazes around the surface and
  slides free. Facing is unchanged and the player keeps full control throughout.
- **Rock ↔ rock.** Rocks do **not** collide with each other; they pass through one
  another freely. Only bullets and the star destroy rocks.
- **Saucer ↔ rock.** The saucer is unaffected by rocks and passes through
  them; a rock does not destroy the saucer.

A **saucer bullet** (fired by the saucer, `specs/flow.md`) is pulled by gravity
and wraps like any bullet, is absorbed by the star core, and harms **only the
ship** — it passes over rocks and does not split them.
