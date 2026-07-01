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
2. Apply the **gravity acceleration** from the star (all bodies except the
   saucer).
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
  thrust and gravity each step). Momentum and the gravity slingshot can push the
  ship to this cap, but never past it.

The ship carries its velocity through wraps and across states as normal.

## The gravity well (signature mechanic)

The star at `(640, 360)` pulls on the **ship, every bullet, and every rock**. The
saucer is the only exception — it is a powered craft and is never pulled.

For each affected body, every step, add an acceleration toward the star:

```
d      = distance from the body's center to the star center (640, 360)
d_eff  = max(d, 90)                     # softening radius: never divide by less
a_mag  = MU / (d_eff * d_eff)           # MU = 3_000_000  (px^3 / s^2)
a      = a_mag toward the star center   # along the unit vector body -> star
```

- `MU = 3_000_000`. With the softening radius of `90`, the acceleration is
  **capped at about 370 px/s^2** (reached at `d <= 90`) — below the ship's own
  `480 px/s^2` thrust, so a piloted ship can always climb out of the well. Sample
  magnitudes: about `75 px/s^2` at `d = 200`, `208` at `d = 120`, `370` (the cap)
  at `d <= 90`.
- The softening only bounds the math near the center; it does not make the core
  safe. The core (radius `30`, `specs/playfield.md`) is still solid and lethal.
- Gravity uses the body's **direct** vector to the star center, not a
  wrapped one: the star is a single physical point at the middle of the field,
  so a body near a corner is genuinely far from it and barely pulled.

What the pull produces, and why it is the heart of the game:

- **The ship must respect the well.** Drift too close with too little speed and
  the star reels you into its core. You can **slingshot** — dive past the star to
  trade a curved path for speed — but you must thrust to escape it.
- **Shots curve.** Because bullets are pulled too, a shot fired near the star
  bends; a skilled player can **bend a bullet around the star** to hit a rock on
  the far side, or must lead a target whose path the star is curving.
- **Rocks orbit.** Rocks swing through the field on curved, wrapping paths rather
  than straight lines, so the board is always churning. A rock drawn into the core
  is recycled to the edge (`specs/playfield.md`), keeping the field populated.

## Bullets

- **Muzzle velocity.** A fired bullet's velocity is the **ship's current velocity
  plus 720 px/s along the ship's facing** — so your own drift carries into your
  shots, and a shot fired while moving is faster than one fired at rest.
- **Lifetime.** A bullet is removed **1.1 seconds** after it is fired (this bounds
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

- **Bullet ↔ rock.** The rock is destroyed and the bullet is removed. The rock
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
- **Ship ↔ rock, ship ↔ saucer, ship ↔ saucer bullet, ship ↔ star core.** The ship
  is destroyed and the player loses a life (`specs/flow.md`), unless the ship is
  currently in its post-respawn invulnerability window, in which case it passes
  through unharmed (and, during that window only, is also unaffected by
  gravity — see `specs/flow.md`).
- **Rock ↔ rock.** Rocks do **not** collide with each other; they pass through one
  another freely. Only bullets and the star destroy rocks.
- **Saucer ↔ rock.** The saucer is unaffected by rocks and passes through
  them; a rock does not destroy the saucer.

A **saucer bullet** (fired by the saucer, `specs/flow.md`) is pulled by gravity
and wraps like any bullet, is absorbed by the star core, and harms **only the
ship** — it passes over rocks and does not split them.
