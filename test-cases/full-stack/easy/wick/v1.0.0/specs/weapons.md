# Wick — Weapons

This file defines the ten base weapons: the rules every weapon shares, how each
one targets and fires, and the level table each one reads its figures from. The
lamplighter never fires by hand; every held weapon fires on its own timer. The
derived stats a weapon's figures pass through are in `specs/passives.md`, the
six evolved forms are in `specs/evolutions.md`, and the enemies a weapon hits
are in `specs/enemies.md`.

## Common rules

### Cooldown timers

Each held weapon carries its own cooldown timer, a timer as `specs/world.md`
defines one, independent of every other weapon's. On acquisition the timer is
`0`, so a weapon fires on the first `playing` tick it is held; Taper, Lantern,
Halo, Oil Splash, Pin, Shard, and Flare need no target and fire the same way,
Halo by pulsing. After firing, the timer is set to the weapon's current cooldown,
and the weapon fires again on the tick the timer is due. The current cooldown
is the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`).
Lantern sets its timer differently, as its section states. The timers count
and the weapons fire on the ticks the `weaponFire` switch of
`specs/instrumentation.md` is on, which is how the game is played.

A weapon that needs a target and finds no eligible target does not fire on
that tick, and its timer is set to its current cooldown as though it had. Which
weapons need a target, and what counts as eligible, is in the targeting summary
and each weapon's section below.

### The nearest enemy

The nearest enemy is the live enemy whose center is the smallest Euclidean
distance from the player's center, ties broken by the lowest enemy `id`. The
`n` nearest enemies are the first `n` in that same ordering, distance then
`id`. A direction toward an enemy is the unit vector from the player's center
to the enemy's center, and when the two centers coincide the facing direction
is used instead.

The facing direction is `facing` from `specs/world.md`: `+x` for `"right"`
and `-x` for `"left"`. Angles are in degrees, with `0` along `+x` and positive
angles turning toward `+y`, which is clockwise on screen.

### Shapes and overlap

Every hitbox is one of two shapes in world space: a circle, with a center and a
radius, or an axis-aligned rectangle, with a center, a width, and a height. An
enemy is a circle of its own radius, from `specs/enemies.md`.

- Two circles overlap when the distance between their centers is less than the
  sum of their radii.
- A rectangle and a circle overlap when the distance from the circle's center
  to the nearest point of the rectangle is less than the circle's radius.
- An enemy is within `d` of a point when the distance from that point to the
  enemy's center is at most `d`.

An effect hits an enemy when the effect's shape overlaps the enemy's circle,
except where a weapon's section says its test is distance to the enemy's
center instead. Every zone's position is the center of its shape; a strike's
`radius` is its `area`, a burst's is its Flare `radius`, and a slash carries
its `width` and `height` with a `radius` of `0`.

### Hits and death

A hit removes the shape's damage per hit from the enemy's `hp`. Damage per
hit is the table damage times `damageMul`, a real number, and `hp` is real. A
shape's damage per hit is fixed when the shape is created, from the level and
`damageMul` in force on that tick, with one exception: the aura of Halo or
Corona and each Chandelier lantern have their damage recomputed on every tick,
with their radius. A Wick level gained later leaves every other live shape's
damage as it was.

On a tick the projectiles hit first, in ascending `id`, then the zones in
ascending `id`, and an enemy stays live until every shape has hit: a shape
hits an enemy whose `hp` an earlier shape of the same tick already took to `0`
or below, spending its pierce, recording its entry, and healing as its weapon
states. On any tick an enemy's `hp` is at or below `0` after the hits the
enemy dies on that tick: the kill count rises by one, the enemy drops what
`specs/enemies.md` lists for it, the bread and draft draws of `specs/world.md`
are made, and every re-hit entry naming it is dropped. Hits and deaths play
the `hit` and `kill` cues as `specs/ui.md` states.

### Projectiles and pierce

A projectile is a circle that moves at a constant velocity from the tick after
it is fired, except Sconce, which decelerates, and Shard, which bounces. On
each tick it moves, its position advances by its velocity times `TICK_DT`, and
then its velocity changes by its acceleration times `TICK_DT`. A fired
projectile's acceleration is `(0, 0)` for every weapon but Sconce, whose
acceleration is the one its section states. Every hit lowers its `pierce` by
one, and a hit on a projectile whose `pierce` is `0` removes it instead, so a
projectile with `pierce` `n` hits `n + 1` enemies. A projectile whose `pierce`
is `INFINITE_PIERCE` (`-1`) is never lowered and never removed by a hit. A
projectile's `ttl` is set to its `duration` when it is fired, and it is removed
on the tick `ttl` is due, whether or not it hit anything.

A projectile with finite pierce hits a given enemy at most once: its re-hit
entry for that enemy carries the projectile's remaining `ttl` at the hit, so
the entry outlives the projectile. When one such projectile overlaps several
enemies on the same tick, they are hit in ascending enemy `id` until the
projectile is removed. A projectile with infinite pierce hits a given enemy at
most once per its weapon's re-hit interval, timed per projectile and per enemy
from the tick of the previous hit.

### Persistent effects

A persistent effect is a shape that stays in the world for a while and damages
an enemy at most once per interval. There are two kinds. A pulsing effect (the
Halo aura and Oil Splash puddles) damages every enemy overlapping it on each
pulse tick, and the interval is the time between pulses. A touching effect
(each Lantern lantern, each Shard, and each Sconce) damages an enemy on any
tick the two overlap, at most once per re-hit interval per effect per enemy.
A re-hit entry names a live enemy: when the enemy it names is removed, by
death, by despawning, or by a pose of the debug surface, the entry is dropped
with it.

### Amount

A weapon's amount is the table amount plus `amountBonus`, read on the tick it
fires. It counts the projectiles, puddles, strikes, or lanterns one firing
produces. Halo and Flare ignore amount.

### Derived stats

Each column of a level table passes through the derived stats of
`specs/passives.md` as follows, read on the tick the weapon fires. A shape's
lengths and its damage are fixed when it is created, with one exception: the
aura's radius and damage, and each Chandelier lantern's orbit, radius, and
damage, are recomputed on every tick from the level, `areaMul`, and
`damageMul` in force on that tick.

| Column | Used as |
| --- | --- |
| Damage | table value × `damageMul` |
| Cooldown | table value × `cooldownMul`, floored at `MIN_COOLDOWN` |
| Width, Height, Radius, Orbit, Area | table value × `areaMul` |
| Amount | table value + `amountBonus` |
| Speed, Pierce, Duration | table value, unchanged |

`areaMul` scales every hitbox length, projectile collision radii included.
`OIL_SCATTER`, `SPARK_RANGE`, `PIN_SPREAD`, the spread angles, and the re-hit
intervals are unchanged by any passive.

## Targeting summary

The ten base weapons are `BASE_WEAPON_IDS`, in this order, with their display
names in `WEAPON_NAMES`. A weapon marked as needing a target does not fire
without one.

| Weapon | Id | Shape | Fires | Needs a target |
| --- | --- | --- | --- | --- |
| Taper | `taper` | horizontal slash rectangle | in the facing direction, from the player's `x` outward | no |
| Ember | `ember` | bolt | at the nearest enemy | yes |
| Pin | `pin` | dart | in the facing direction | no |
| Lantern | `lantern` | orbiting lanterns | around the player for a duration | no |
| Halo | `halo` | aura circle | pulses on everything inside | no |
| Oil Splash | `oil-splash` | puddles | at random points near the player | no |
| Spark | `spark` | strike | on random enemies within `SPARK_RANGE` | yes, within `SPARK_RANGE` |
| Shard | `shard` | bouncing bolt | toward the nearest enemy, or in the facing direction if none, bouncing off the view edges | no |
| Sconce | `sconce` | boomerang | toward the nearest enemy, decelerating and returning | yes |
| Flare | `flare` | burst | on every enemy within range | no |

Every level table has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`.
The tables are `TAPER_LEVELS`, `EMBER_LEVELS`, `PIN_LEVELS`,
`LANTERN_LEVELS`, `HALO_LEVELS`, `OIL_SPLASH_LEVELS`, `SPARK_LEVELS`,
`SHARD_LEVELS`, `SCONCE_LEVELS`, and `FLARE_LEVELS`, collected by id in
`WEAPON_LEVELS`.

## Taper

A slash is a rectangle of `width × height`: on the tick it fires it hits
every enemy overlapping it, and it has no hitbox on any other tick. Its near
vertical edge is at the player's `x`, it extends `width` in the facing
direction, and it is centered vertically on the player's `y`. The slash is
drawn for `SLASH_FLASH` (`0.1`) seconds.

With amount `2` a second slash fires on the same tick, mirrored to the opposite
side of the player. Any amount above `TAPER_MAX_AMOUNT` (`2`) adds nothing.

| Level | Damage | Cooldown | Width | Height | Amount |
| --- | --- | --- | --- | --- | --- |
| 1 | 10 | 1.35 | 120 | 40 | 1 |
| 2 | 15 | 1.35 | 120 | 40 | 1 |
| 3 | 15 | 1.35 | 120 | 40 | 2 |
| 4 | 15 | 1.35 | 140 | 48 | 2 |
| 5 | 20 | 1.35 | 140 | 48 | 2 |
| 6 | 20 | 1.20 | 140 | 48 | 2 |
| 7 | 25 | 1.20 | 140 | 48 | 2 |
| 8 | 30 | 1.20 | 160 | 56 | 2 |

## Ember

A bolt is a circle of `radius`, fired from the player's center at `speed` in
the direction of the nearest enemy's center on the tick of firing. It flies in
a straight line and is removed after `duration` seconds. Its pierce is the
table `pierce`.

With amount `n`, `n` bolts fire on the same tick, one at each of the `n`
nearest distinct enemies, fewer when fewer enemies exist. Ember needs at least
one enemy to fire.

| Level | Damage | Cooldown | Speed | Radius | Pierce | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 10 | 1.20 | 400 | 8 | 0 | 2.0 | 1 |
| 2 | 10 | 1.20 | 400 | 8 | 0 | 2.0 | 2 |
| 3 | 10 | 1.00 | 400 | 8 | 0 | 2.0 | 2 |
| 4 | 15 | 1.00 | 400 | 8 | 0 | 2.0 | 2 |
| 5 | 15 | 1.00 | 400 | 8 | 1 | 2.0 | 2 |
| 6 | 15 | 1.00 | 400 | 8 | 1 | 2.0 | 3 |
| 7 | 20 | 0.90 | 400 | 8 | 1 | 2.0 | 3 |
| 8 | 25 | 0.80 | 450 | 10 | 2 | 2.0 | 3 |

## Pin

A dart is a circle of `radius`, fired horizontally in the facing direction at
`speed`, and removed after `duration` seconds. Its pierce is the table
`pierce`. Pin fires whether or not any enemy exists.

Amount `n` darts fire on the same tick, spread vertically: dart `i`, counted
from `0`, starts at `x = player.x` and
`y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with `PIN_SPREAD` (`10`).

| Level | Damage | Cooldown | Speed | Radius | Pierce | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 6 | 0.50 | 600 | 6 | 1 | 1.5 | 1 |
| 2 | 6 | 0.50 | 600 | 6 | 1 | 1.5 | 2 |
| 3 | 8 | 0.50 | 600 | 6 | 1 | 1.5 | 2 |
| 4 | 8 | 0.50 | 600 | 6 | 2 | 1.5 | 3 |
| 5 | 10 | 0.50 | 600 | 6 | 2 | 1.5 | 3 |
| 6 | 10 | 0.40 | 600 | 6 | 2 | 1.5 | 4 |
| 7 | 12 | 0.40 | 600 | 6 | 3 | 1.5 | 4 |
| 8 | 15 | 0.35 | 700 | 7 | 3 | 1.5 | 5 |

## Lantern

On firing, `amount` lanterns appear on a circle of radius `orbit` around the
player's center, evenly spaced: lantern `i`, counted from `0`, starts at angle
`i × 360 / amount`. Each lantern is a circle of `radius`, and each is a zone
with `ttl` set to `duration`. From the next tick they revolve at
`LANTERN_ANGULAR_SPEED` (`180`) degrees per second clockwise, so lantern `i`
sits at angle `i × 360 / amount + LANTERN_ANGULAR_SPEED × t` after `t`
seconds, and the circle they ride is centered on the player's center every
tick. `orbit` and `radius` are fixed when the set is created.

Each lantern is a touching effect with re-hit interval `LANTERN_REHIT`
(`0.5`), timed per lantern per enemy. The lanterns vanish on the tick their
`ttl` is due. On firing, Lantern's cooldown timer is set to `duration` plus
the current cooldown, both read on that tick, so the timer is due once the set
has been gone for the cooldown and one set is in the world at a time. A set is
fixed when it is created: a Mirror level gained while a set lives leaves that
set's count as it is, and the next firing reads the new amount.

| Level | Damage | Cooldown | Orbit | Radius | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 10 | 3.0 | 90 | 14 | 3.0 | 1 |
| 2 | 10 | 3.0 | 90 | 14 | 3.0 | 2 |
| 3 | 15 | 3.0 | 90 | 14 | 3.0 | 2 |
| 4 | 15 | 3.0 | 100 | 16 | 3.5 | 2 |
| 5 | 15 | 3.0 | 100 | 16 | 3.5 | 3 |
| 6 | 20 | 2.5 | 100 | 16 | 3.5 | 3 |
| 7 | 20 | 2.5 | 110 | 18 | 4.0 | 3 |
| 8 | 25 | 2.5 | 120 | 20 | 4.0 | 4 |

## Halo

Halo is a permanent aura: one zone of kind `aura`, a circle of `radius`
centered on the player's center every tick. The zone is created on the first
`playing` tick Halo is held and none exists, it is removed on the next
`playing` tick Halo is no longer held, and its `radius` and `damage` are
recomputed on every tick from the level, `areaMul`, and `damageMul` in force
on that tick. It is a pulsing effect whose interval is its cooldown: on each tick
the cooldown timer is due it pulses, every enemy whose circle overlaps the
aura takes `damage`, and the timer is set to the current cooldown. Halo pulses
on the first `playing` tick it is held. Amount is ignored.

| Level | Damage | Cooldown | Radius |
| --- | --- | --- | --- |
| 1 | 3 | 1.00 | 80 |
| 2 | 3 | 1.00 | 90 |
| 3 | 4 | 1.00 | 90 |
| 4 | 4 | 0.80 | 100 |
| 5 | 5 | 0.80 | 100 |
| 6 | 5 | 0.80 | 110 |
| 7 | 6 | 0.70 | 110 |
| 8 | 8 | 0.60 | 120 |

## Oil Splash

On firing, `amount` puddles appear, each centered at an independent uniformly
random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
center: a distance `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with
`u` uniform on `[0, 1)`. A puddle is a circle of `radius` that stays where it
landed for `duration` seconds and then vanishes. Oil Splash fires whether or
not any enemy exists.

A puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`): it pulses on
the tick it appears and on every `OIL_PULSE` interval of ticks after, and each
pulse deals `damage` to every enemy overlapping it.

| Level | Damage | Cooldown | Radius | Duration | Amount |
| --- | --- | --- | --- | --- | --- |
| 1 | 4 | 3.0 | 50 | 2.5 | 1 |
| 2 | 4 | 3.0 | 50 | 2.5 | 2 |
| 3 | 5 | 3.0 | 55 | 2.5 | 2 |
| 4 | 5 | 2.5 | 55 | 3.0 | 2 |
| 5 | 6 | 2.5 | 60 | 3.0 | 3 |
| 6 | 6 | 2.5 | 60 | 3.5 | 3 |
| 7 | 7 | 2.0 | 65 | 3.5 | 3 |
| 8 | 8 | 2.0 | 70 | 4.0 | 4 |

## Spark

On firing, `amount` strikes land, each on a distinct enemy chosen uniformly at
random among the live enemies within `SPARK_RANGE` (`600`) of the player's
center, fewer when fewer such enemies exist. Spark's eligible targets are the
enemies within `SPARK_RANGE`: with none within it, whatever is alive farther
away, Spark does not fire and its timer is set to its current cooldown. A
strike deals `damage` to its target and to every other enemy within `area` of
the target's center, on the tick it lands.

The strike is drawn for `SPARK_FLASH` (`0.2`) seconds and has no hitbox after
the tick it lands.

| Level | Damage | Cooldown | Area | Amount |
| --- | --- | --- | --- | --- |
| 1 | 15 | 2.0 | 40 | 1 |
| 2 | 15 | 2.0 | 40 | 2 |
| 3 | 20 | 2.0 | 40 | 2 |
| 4 | 20 | 1.8 | 50 | 2 |
| 5 | 25 | 1.8 | 50 | 3 |
| 6 | 25 | 1.6 | 50 | 3 |
| 7 | 30 | 1.6 | 60 | 3 |
| 8 | 40 | 1.4 | 70 | 4 |

## Shard

A shard is a circle of `radius`, fired from the player's center at `speed`
toward the nearest enemy, or in the facing direction when no enemy exists, so
Shard fires whether or not any enemy exists. Its pierce is `INFINITE_PIERCE`,
its re-hit interval is `SHARD_REHIT` (`0.5`) per shard per enemy, and it is
removed after `duration` seconds.

While alive a shard stays inside the view: the `STAGE_W × STAGE_H`
(`1280 × 720`) rectangle centered on the player's center on that tick, after
the lamplighter has moved. After the shard's move on a tick, a center past an
edge of that rectangle is clamped to that edge, and the velocity component
across that edge reverses when it points outward and is left as it is when it
already points inward; a center past a corner is clamped on both axes, each
component treated the same way.

Amount `n` fires `n` shards on the same tick, shard `i` counted from `0` with
its direction rotated by `(i − (n − 1) / 2) × SHARD_SPREAD` degrees, with
`SHARD_SPREAD` (`15`).

| Level | Damage | Cooldown | Speed | Radius | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 2.5 | 500 | 8 | 3.0 | 1 |
| 2 | 8 | 2.5 | 500 | 8 | 3.5 | 1 |
| 3 | 10 | 2.5 | 500 | 8 | 3.5 | 2 |
| 4 | 10 | 2.2 | 500 | 8 | 4.0 | 2 |
| 5 | 12 | 2.2 | 500 | 8 | 4.0 | 2 |
| 6 | 12 | 2.0 | 550 | 9 | 4.5 | 3 |
| 7 | 15 | 2.0 | 550 | 9 | 4.5 | 3 |
| 8 | 20 | 1.8 | 600 | 10 | 5.0 | 3 |

## Sconce

A sconce is a circle of `radius`, launched from the player's center at `speed`
along the launch direction `d`, the direction of the nearest enemy on the tick
of firing. Sconce needs at least one enemy to fire. Its velocity along `d`
falls under a constant acceleration of `−SCONCE_DECEL` (`600`) units per second
squared, integrated per tick as Projectiles and pierce states, position first
and then velocity, so after `n` moving ticks its velocity is
`(speed − SCONCE_DECEL × n × TICK_DT) × d`. It reverses once
`speed / SCONCE_DECEL` seconds of motion have passed and returns past the
launch point, which stays where the player's center was on the tick of
firing.

Its pierce is `INFINITE_PIERCE`, its re-hit interval is `SCONCE_REHIT` (`0.5`)
per sconce per enemy, and it is removed after `duration` seconds. Amount `n`
launches `n` sconces on the same tick, sconce `i` counted from `0` with its
direction rotated by `(i − (n − 1) / 2) × SCONCE_SPREAD` degrees, with
`SCONCE_SPREAD` (`20`).

| Level | Damage | Cooldown | Speed | Radius | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 12 | 2.0 | 600 | 12 | 2.5 | 1 |
| 2 | 12 | 2.0 | 600 | 12 | 2.5 | 2 |
| 3 | 16 | 2.0 | 600 | 12 | 2.5 | 2 |
| 4 | 16 | 1.8 | 600 | 14 | 2.5 | 2 |
| 5 | 20 | 1.8 | 600 | 14 | 2.5 | 3 |
| 6 | 20 | 1.6 | 600 | 14 | 2.5 | 3 |
| 7 | 24 | 1.6 | 600 | 16 | 2.5 | 3 |
| 8 | 30 | 1.4 | 600 | 16 | 2.5 | 4 |

## Flare

On firing, every enemy within `radius` of the player's center takes `damage`
on that tick, except the enemies listed in `FLARE_IMMUNE` (`["dark"]`), which
a flare leaves untouched. Flare fires whether or not any enemy exists, and
amount is ignored. The burst is drawn for `FLARE_FLASH` (`0.4`) seconds and
has no hitbox after the tick it fires.

| Level | Damage | Cooldown | Radius |
| --- | --- | --- | --- |
| 1 | 100 | 60 | 640 |
| 2 | 100 | 55 | 640 |
| 3 | 150 | 55 | 640 |
| 4 | 150 | 50 | 640 |
| 5 | 200 | 50 | 640 |
| 6 | 200 | 45 | 640 |
| 7 | 300 | 45 | 640 |
| 8 | 500 | 40 | 640 |
