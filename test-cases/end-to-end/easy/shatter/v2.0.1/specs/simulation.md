# Shatter — The simulation, gravity, and collision

This file defines how everything moves and interacts: the update loop, the gravity
well the star exerts, and every collision rule. It builds on the geometry in
`specs/playfield.md`, `specs/ship.md`, and `specs/hazards.md`.

## The simulation loop

Run the simulation on a fixed timestep of 120 Hz — a step of exactly 1/120 of a
second — integrated in whole steps and decoupled from rendering. The rate is fixed
rather than a suggestion, because `specs/instrumentation.md` advances the simulation
in whole ticks of it: a tick is only a unit if its length is fixed. The core
simulation is render-free: game state advances by stepping it, with no
dependence on the canvas, on wall-clock time, or on the renderer. Any randomness
the game uses runs off a seedable generator, so a given seed and sequence of
steps reproduce the same result every time. Determinism keeps the game
reproducible and is the basis for the debugging and automation surface in
`specs/instrumentation.md`.

Each step, for every dynamic body (the ship, each bullet, each rock, the saucer):

1. Apply the body's own control forces (ship thrust; saucer steering).
2. Apply the gravity acceleration from the star to every bullet and every rock (not
   the ship or the saucer, both powered craft).
3. Advance velocity, then position, by `dt`.
4. Wrap position across the field edges (`specs/playfield.md`).
5. Resolve collisions (below).

Inertial flight, the ship's rotation, thrust, drag, and speed cap are defined in
`specs/ship.md`.

## The gravity well

The star at `(640, 360)` pulls on every bullet and every rock. The ship and the
saucer are the two exceptions: both are powered craft with their own thrusters, and
neither is ever pulled. This keeps flight under the player's full control, so the
star shapes the board (curving shots and the rocks' paths) without wresting the ship
from the player's hands.

For each affected body, every step, add an acceleration toward the star:

```
d      = distance from the body's center to the star center (640, 360)
d_eff  = max(d, 90)                     # softening radius: never divide by less
a_mag  = MU / (d_eff * d_eff)           # MU = 4_500_000  (px^3 / s^2)
a      = a_mag toward the star center   # along the unit vector body -> star
```

- `MU = 4_500_000`. With the softening radius of 90, the acceleration is capped at
  about 556 px/s^2 (reached at `d <= 90`). Sample magnitudes: about 112 px/s^2 at
  `d = 200`, 312 at `d = 120`, and 556 (the cap) at `d <= 90`. The softening bounds
  the pull near the center so it stays finite as a body nears the core rather than
  blowing up.
- The pull is strong enough that bullets and rocks visibly bend as they pass the
  star, not merely drift a few pixels off a straight line.
- The core (radius 30, `specs/playfield.md`) is solid and impassable, but it is not
  lethal to the ship: a ship that reaches it slides along its surface (see Collision
  below).
- Gravity uses the body's direct vector to the star center, not a wrapped one: the
  star is a single physical point at the middle of the field, so a body near a corner
  is genuinely far from it and barely pulled.

A self-propelled munition that a mode (`specs/gameplay.md`) adds likewise holds its own
course and, like the ship and saucer, is not pulled by the well.

## Collision

Treat every body as a circle of the radius given in `specs/ship.md` and
`specs/hazards.md` (ship 14, bullets 3, rocks 46/26/14, saucer 18, star core 30).
Use the shortest wrapped distance between centers when testing a pair, so bodies
touching across a wrap seam collide. So that no fast body passes through another in a
single step, use swept or continuous collision, or a timestep small enough that no
body moves more than its own radius per step.

Resolve these interactions:

- Bullet and rock. A bullet that hits a rock is removed. Whether that hit destroys
  the rock outright or only lowers the health of an armored rock is set by
  `specs/gameplay.md`. On the hit that destroys the rock, the rock splits per
  `specs/hazards.md` (Large to two Medium, Medium to two Small, Small to nothing) and
  its score is awarded (`specs/gameplay.md`). Each fragment spawns at the destroyed
  rock's position and takes the parent's velocity plus a split kick of about 90 px/s
  directed perpendicular to the bullet's travel, the two fragments kicked to opposite
  sides, so the angle of the shot fans the pieces apart. Fragments then obey gravity
  like any rock.
- Bullet and saucer. The saucer is destroyed (score 200, `specs/gameplay.md`) and the
  bullet is removed.
- Bullet and star core. The bullet is absorbed and removed.
- Rock and star core. The rock is destroyed and recycled per `specs/hazards.md`: a
  same-size replacement re-enters from off-screen, with no score and the count
  unchanged.
- Ship and rock, ship and saucer, ship and saucer bullet. The ship is destroyed and
  the player loses a life (`specs/gameplay.md`), unless the ship is in its post-respawn
  invulnerability window, in which case it passes through unharmed (`specs/gameplay.md`).
- Ship and star core. The core is a solid but non-lethal obstacle for the ship:
  touching it never costs a life and never destroys the ship. Instead the ship slides
  along the core. On contact, push the ship's center back out to a distance of
  `core radius + ship radius` (= 44) from the star center along the star-to-ship
  direction, and remove the component of its velocity heading into the core while
  keeping the tangential component, so it grazes around the surface and slides free.
  Facing is unchanged and the player keeps full control throughout.
- Rock and rock. Rocks do not collide with each other; they pass through one another
  freely. Only bullets and the star destroy rocks.
- Saucer and rock. The saucer is unaffected by rocks and passes through them; a rock
  does not destroy the saucer.

A saucer bullet (fired by the saucer, `specs/hazards.md`) is pulled by gravity and
wraps like any bullet, is absorbed by the star core, and harms only the ship: it
passes over rocks and does not split them.
