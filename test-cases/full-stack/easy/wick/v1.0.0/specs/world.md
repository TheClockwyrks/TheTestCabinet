# Wick — The world and the lamplighter

This file defines the plane the night is played on, the camera that follows the
lamplighter, the order of a tick, the lamplighter's movement, facing, health,
and the damage enemies deal by touch, how a run ends, and the gems and pickups
that enemies leave behind. The enemies themselves are in `specs/enemies.md` and
the weapons in `specs/weapons.md`. The derived stats this file reads,
`moveSpeed`, `maxHp`, `armor`, `recovery`, `pickupRadius`, and `xpMul`, are
computed as `specs/passives.md` states. Every figure below carries the name
this specification gives it.

## The plane

The world is an unbounded plane measured in units, the same units as the
`STAGE_W x STAGE_H` (`1280 x 720`) stage. A world position is written
`(x, y)`, with `x` increasing to the right and `y` increasing downward, matching
the stage. The origin `(0, 0)` is where the lamplighter stands when a run
starts, and nothing bounds how far from it the lamplighter may walk.

Every length in this file is in units, every rate is per second, and every
duration is in seconds. The simulation advances on the fixed tick
`specs/overview.md` states, `TICK_HZ` (`60`) ticks per second, each covering
`TICK_DT` (`1 / 60`) seconds, and every rule below is applied once per tick.
The run clock `time` is `tick / TICK_HZ` seconds and is `0` when a run starts.

## Timers

Every timer in this specification is in seconds. On every tick a timer counts
down by `TICK_DT` and is held at `0`: a count-down that would leave it below
`TICK_DT / 2` leaves it at exactly `0`. A timer is due on every tick on which
it is `0` after its count-down, so a timer set to `s` seconds is due
`round(s × TICK_HZ)` ticks after the tick it was set on, and a timer at `0`
stays due on every tick until it is set again. An interval of `s` seconds
anywhere in this specification is likewise `round(s × TICK_HZ)` ticks. The
weapon cooldown timers, the contact cooldowns, the lamplighter's `hurtFlash`,
the re-hit entries, the spawn timer, and every `ttl` all count this way. A
timer held by one of the driver switches `specs/instrumentation.md` names, a
weapon's cooldown timer while `weaponFire` is off or `spawnTimer` while
`spawning` is off, neither counts down nor is due until the switch is on
again.

## One tick

A tick applies the phases below in this order, each reading the state the
phases before it left. Where a phase names one of the driver switches
`specs/instrumentation.md` defines, the phase runs while that switch is on,
which is how the game is played, and holds while it is off.

1. The clock. `tick` rises by one, and every phase below reads the new value.
2. The lamplighter moves and `facing` updates, as Movement and Facing state.
3. Recovery, as Health and recovery states.
4. Every enemy ages by `TICK_DT`, and, while `enemyMotion` is on, moves as
   `specs/enemies.md` states.
5. The weapons, in two parts. The firing, while `weaponFire` is on: each held
   weapon's timer counts down, and each weapon whose timer is due fires,
   creating its projectiles and zones at the lamplighter's and the enemies'
   positions of this tick. The placement, on every `playing` tick: an aura is
   created on a tick its weapon is held and none exists, and a Chandelier
   lantern set on a tick Chandelier is held and no Chandelier lantern exists;
   an aura or a lantern set is removed on a tick its weapon is no longer held;
   the aura's center and each lantern's center are placed about the
   lamplighter's position of this tick; and the aura's radius and damage and
   each Chandelier lantern's orbit, radius, and damage are recomputed from the
   level, `areaMul`, and `damageMul` in force. A base Lantern set is created by
   firing alone.
6. Projectiles and zones. Every projectile and zone that existed before this
   tick counts its `ttl` down and is removed when it is due; every re-hit entry
   counts down. Then, while `effectMotion` is on, every remaining projectile
   moves, the lanterns revolve, the shards bounce, and the sconces decelerate:
   a projectile's position advances by its velocity times `TICK_DT`, then its
   velocity changes by its acceleration times `TICK_DT`. Then every projectile
   and zone hits, this tick's new ones included, a new one hitting at the
   position it was created at and first moving on the next tick: the
   projectiles first, in ascending `id`, then the zones in ascending `id`.
   Every enemy is live until the hits are done, so a shape hits an enemy whose
   `hp` an earlier shape of this tick already took to `0` or below. Then an
   enemy whose `hp` is at or below `0` dies, and every re-hit entry naming it
   is dropped; while `drops` is on its drop and its bread or draft land at its
   center, at rest for this tick.
7. Contact. Every live enemy's `contactCooldown` and the lamplighter's
   `hurtFlash` count down, and, while `enemyContact` is on, an overlapping
   enemy whose cooldown is due hits, as Contact damage states.
8. Pickups. Every pickup meeting the collection condition is collected, this
   tick's drops included.
9. Gems. Every gem within `pickupRadius` becomes attracted, every attracted
   gem that existed before this tick moves, and every gem within
   `COLLECT_RADIUS` is collected, this tick's drops and the gems a draft
   attracted on this tick included. A gem dropped on this tick is attracted
   and collected by the same tests as any other and takes its first flight
   step on the next tick.
10. The spawn director, as `specs/enemies.md` states: despawning while
    `despawning` is on, then the scripted events while `events` is on, then
    the spawn timer while `spawning` is on. An enemy spawned on this tick sits
    at its spawn point and first moves on the next tick.
11. The endings, as Fallen and dawn states.
12. The overlays. A tick that ends the run opens no overlay. Otherwise a tick
    that collected a chest opens the chest overlay, and a tick that ends with a
    level-up queued and no chest collected opens the level-up overlay, as
    `specs/progression.md` states.

## The camera and the view

The camera is centered on the lamplighter at all times. A world point
`(wx, wy)` is drawn at the stage position
`(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`, with `STAGE_CX` (`640`)
and `STAGE_CY` (`360`) the stage center, so the lamplighter is always drawn at
the center of the stage. The view is the `STAGE_W x STAGE_H` rectangle of the
world centered on the lamplighter: `x` from `player.x - STAGE_CX` to
`player.x + STAGE_CX` and `y` from `player.y - STAGE_CY` to
`player.y + STAGE_CY`, recomputed every tick as the lamplighter moves.

The ground is drawn as a pattern fixed in world space and repeating on both
axes, so that the lamplighter's motion reads against it. What the pattern looks
like is yours.

## The lamplighter

| Figure | Constant | Value |
| --- | --- | --- |
| Base move speed, units per second | `MOVE_SPEED` | `180` |
| Collision radius | `PLAYER_RADIUS` | `12` |
| Base maximum health | `BASE_MAX_HP` | `100` |
| Base recovery, health per second | `BASE_RECOVERY` | `0` |
| Base pickup radius | `PICKUP_RADIUS` | `48` |

The lamplighter is a circle of radius `PLAYER_RADIUS` centered on
`(player.x, player.y)`. A run starts with the lamplighter at the origin, facing
`"right"`, with `hp` equal to `maxHp`, which is `BASE_MAX_HP` while no Tallow
is held.

### Movement

The lamplighter is moved by the four actions `up`, `down`, `left`, and `right`,
each read as a held value on the `playing` screen, as `specs/controls.md`
states. The movement direction is the sum of the unit vectors of the held
actions, `up` `(0, -1)`, `down` `(0, 1)`, `left` `(-1, 0)`, and `right`
`(1, 0)`, normalized to unit length when the sum is non-zero. The velocity is
that direction times `moveSpeed`, and each tick the position advances by the
velocity times `TICK_DT`.

Diagonal movement is therefore exactly as fast as cardinal movement, and two
opposite actions held together cancel to no movement on that axis. `moveSpeed`
is `MOVE_SPEED` times the speed multiplier `specs/passives.md` defines, so
with no Bellows held it is `MOVE_SPEED`. The world is unbounded, so no edge
stops the lamplighter.

### Facing

`facing` is `"left"` or `"right"` and starts as `"right"`. On any tick whose
movement direction has a non-zero horizontal component, `facing` becomes the
direction of that component: `"left"` when it is negative and `"right"` when
it is positive. A tick with no horizontal component, whether the lamplighter is
still or moving straight up or down, leaves `facing` as it was. The weapons in
`specs/weapons.md` that fire in the facing direction read this value, and the
lamplighter's sprite is drawn facing the same way.

### Health and recovery

`hp` is a real number at most `maxHp`; a hit may take it below `0`, which ends
the run. On every tick, before contact damage is applied:

```
hp = min(maxHp, hp + recovery × TICK_DT)
```

`recovery` is in health per second and is `BASE_RECOVERY` with no Tinder held.
Every heal from any source, bread, lamp-oil, a chest, or a weapon, adds to `hp`
and caps it at the `maxHp` in force when the heal is applied.

### Contact damage

| Figure | Constant | Value |
| --- | --- | --- |
| Seconds between hits by one enemy | `CONTACT_COOLDOWN` | `0.5` |
| Least health a hit removes | `MIN_DAMAGE_TAKEN` | `1` |
| Seconds the hurt flash runs | `HURT_FLASH` | `0.3` |

Every enemy carries its own contact cooldown, `contactCooldown`, a timer that
is `0` when the enemy spawns. On every tick, for every live enemy, the enemy's
circle overlaps the lamplighter's when the distance between their centers is
less than the enemy's radius plus `PLAYER_RADIUS`. An overlapping enemy whose
`contactCooldown` is due lands a hit: `hp` falls by
`max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, and its `contactCooldown` is set
to `CONTACT_COOLDOWN`.

The cooldown counts down on every tick the enemy is alive, in or out of
contact. An enemy in continuous contact therefore hits once every
`CONTACT_COOLDOWN` seconds, and several overlapping enemies each hit on their
own schedule. Enemy damage and radius per type are in `specs/enemies.md`;
`armor` is `0` with no Brass held.

The lamplighter carries `hurtFlash`, a timer that counts down with the contact
cooldowns in phase 7 and is set to `HURT_FLASH` on every tick on which a
contact hit lands, whatever the number of hits that tick. It is `0` on the idle
run and on a fresh run, and a contact hit is the only thing that sets it, so a
heal from any source leaves it as it was. What the flash looks like is in
`specs/ui.md`.

### Fallen and dawn

`DAWN_TIME` (`600`) seconds is the length of the night. A run ends at the end
of a tick, after every other phase of that tick has been applied, in one of two
ways:

| Ending | Condition | `screen` |
| --- | --- | --- |
| Dawn | `tick` equals `DAWN_TIME × TICK_HZ` (`36000`). | `dawn` |
| Fallen | `hp` is `0` or below. | `fallen` |

Dawn is checked first, so a tick on which both conditions hold ends the run at
dawn. A run that has ended ticks no further. A tick that ends the run opens no
overlay: a chest it collected has its result applied and no overlay shown, with
`chestResult` left set so the end screen's run reports it, and a level-up it
queued stays queued. The delta time left unconsumed by the frame that ended the
run is discarded, so the accumulator is `0` on an end screen as on every screen
but `playing`. What each ending screen shows is in `specs/ui.md`.

## Gems

`GEM_TIERS` lists the three tiers in this order and `GEM_VALUES` gives the
experience each grants.

| Tier | Experience |
| --- | --- |
| `small` | `1` |
| `medium` | `3` |
| `large` | `10` |

A gem is `{ id, tier, x, y, attracted }`. While `drops` is on, every common
enemy drops one gem of the tier `specs/enemies.md` lists for its type, at the
enemy's position, on the tick it dies. A gem sits where it was dropped until
it is attracted, and it stays on the field until it is collected.

### Attraction and flight

| Figure | Constant | Value |
| --- | --- | --- |
| Flight speed, units per second | `GEM_SPEED` | `600` |
| Collection distance | `COLLECT_RADIUS` | `8` |

On every tick, a gem whose center is at most `pickupRadius` from the
lamplighter's center becomes attracted, and a gem once attracted stays
attracted. `pickupRadius` is `PICKUP_RADIUS` times the pickup multiplier
`specs/passives.md` defines, so it is `PICKUP_RADIUS` with no Lure held. A
draft attracts every gem on the field at once, as the pickups section below
states.

An attracted gem moves toward the lamplighter's center each tick by
`GEM_SPEED × TICK_DT`, stopping at the center rather than passing it. After it
moves, a gem whose center is at most `COLLECT_RADIUS` from the lamplighter's
center is collected on that tick: it is removed, and `xp` rises by
`GEM_VALUES[tier] × xpMul`, a real number. `xpMul` is `1` with no Soot held.
What that experience does is in `specs/progression.md`.

## Pickups

`PICKUP_KINDS` lists the three kinds in this order. A pickup is
`{ id, kind, x, y }`; it sits where it was dropped and stays on the field until
it is collected.

| Kind | Dropped by | On collection |
| --- | --- | --- |
| `chest` | An elite, at its position, on the tick it dies. | Opens the chest overlay, as `specs/progression.md` states. |
| `bread` | A common enemy, by the roll below. | Heals `BREAD_HEAL` (`30`), capped at `maxHp`. |
| `draft` | A common enemy, by the roll below. | Every gem on the field becomes attracted. |

### Collection

A pickup is collected on any tick on which the distance between its center and
the lamplighter's center is less than `PICKUP_ITEM_RADIUS` (`16`) plus
`PLAYER_RADIUS`, the same distance at every Lure level. Every bread and draft
that meets the condition on a tick is collected on that tick. Of the chests
that meet it on one tick, the one with the lowest `id` alone is collected, and
the others wait for the next `playing` tick.

### The drop roll

| Figure | Constant | Value |
| --- | --- | --- |
| Probability a common kill drops bread | `BREAD_CHANCE` | `0.02` |
| Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005` |

While `drops` is on, each common enemy killed by a weapon rolls for a pickup
on the tick it dies; while it is off no kill rolls. The roll drops bread with
probability `BREAD_CHANCE`, and only when it dropped no bread it drops a draft
with probability `DRAFT_CHANCE`, so a kill drops one pickup or none. The pickup
lands at the enemy's position beside its gem. Elites and the Dark make no roll;
an elite drops its chest, and the Dark drops nothing.
`specs/instrumentation.md` states how a scenario poses what the next roll
drops.
