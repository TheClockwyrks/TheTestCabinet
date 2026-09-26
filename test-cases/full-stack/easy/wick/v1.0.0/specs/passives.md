# Wick — Passives and derived stats

This file defines the ten passives a lamplighter can carry and the derived
stats they feed. A passive changes nothing on its own: each one is a single
term in exactly one of the formulas below, and every weapon, every hit taken,
every gem, and the lamplighter's own movement read those formulas rather than
the passive. How passives are offered and accepted is in `specs/progression.md`;
the weapon tables the formulas are applied to are in `specs/weapons.md` and
`specs/evolutions.md`; the lamplighter's base figures are in `specs/world.md`.
Every figure below carries the name this specification gives it.

## The ten passives

`PASSIVE_IDS` lists the ten in this order, and `PASSIVES` gives each one its
display name and its max level.

| Passive | Id        | Max level | Per level held                                 |
| ------- | --------- | --------- | ---------------------------------------------- |
| Wick    | `wick`    | `5`       | `+10%` weapon damage                           |
| Oil     | `oil`     | `5`       | `−8%` weapon cooldown                          |
| Glass   | `glass`   | `5`       | `+10%` area                                    |
| Brass   | `brass`   | `3`       | `+1` armor                                     |
| Mirror  | `mirror`  | `2`       | `+1` amount                                    |
| Bellows | `bellows` | `5`       | `+10%` move speed                              |
| Tallow  | `tallow`  | `5`       | `+15` max health, and `+15` health when gained |
| Tinder  | `tinder`  | `5`       | `+0.5` health per second recovery              |
| Soot    | `soot`    | `5`       | `+10%` experience from gems                    |
| Lure    | `lure`    | `5`       | `+25%` pickup radius                           |

## Holding a passive

The lamplighter has `PASSIVE_SLOTS` (`6`) passive slots, and each slot holds
one passive at one level. A passive enters a slot at level `1` and rises one
level at a time, up to its max level, through the level-up overlay or a chest.
A passive at its max level is never offered again. A run starts with every
passive slot empty.

In every formula below, a passive's name stands for its level as held: a passive
not held is level `0`, so every multiplier starts at `1`, armor and amount
bonus at `0`, and max health and recovery at their base. The terms stack
linearly, and each level adds the same term as the one before it.

## The derived stats

The ten derived stats are the only place a passive acts. Each is a single
formula over the levels held, written here with the constants that fix each
per-level term:

| Term            | Constant                    | Value  |
| --------------- | --------------------------- | ------ |
| Wick damage     | `WICK_DAMAGE_PER_LEVEL`     | `0.1`  |
| Oil cooldown    | `OIL_COOLDOWN_PER_LEVEL`    | `0.08` |
| Glass area      | `GLASS_AREA_PER_LEVEL`      | `0.1`  |
| Brass armor     | `BRASS_ARMOR_PER_LEVEL`     | `1`    |
| Mirror amount   | `MIRROR_AMOUNT_PER_LEVEL`   | `1`    |
| Bellows speed   | `BELLOWS_SPEED_PER_LEVEL`   | `0.1`  |
| Tallow health   | `TALLOW_HP_PER_LEVEL`       | `15`   |
| Tinder recovery | `TINDER_RECOVERY_PER_LEVEL` | `0.5`  |
| Soot experience | `SOOT_XP_PER_LEVEL`         | `0.1`  |
| Lure pickup     | `LURE_PICKUP_PER_LEVEL`     | `0.25` |

```
damageMul   = 1 + WICK_DAMAGE_PER_LEVEL × wick
cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil
areaMul     = 1 + GLASS_AREA_PER_LEVEL × glass
armor       = BRASS_ARMOR_PER_LEVEL × brass
amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror
speedMul    = 1 + BELLOWS_SPEED_PER_LEVEL × bellows
maxHp       = BASE_MAX_HP + TALLOW_HP_PER_LEVEL × tallow
recovery    = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder
xpMul       = 1 + SOOT_XP_PER_LEVEL × soot
pickupMul   = 1 + LURE_PICKUP_PER_LEVEL × lure
```

A derived stat is computed from the levels held at the moment it is read, so a
passive gained mid-run takes effect on the next read: the next hit, the next
time a weapon sets its cooldown timer, the next tick of movement or recovery,
the next gem. Every real-valued result is used as a real number; nothing here
is rounded.

The formulas apply to every weapon alike, base and evolved. An evolved weapon's
single stat row passes through damageMul, cooldownMul, areaMul, and amountBonus
exactly as a base weapon's table row does.

### Damage

A weapon's damage per hit is its table `damage` times `damageMul`. The result
is a real number, and enemy health is a real number, so a hit removes exactly
that amount. A shape's damage per hit is fixed when the shape is created, from
the level and `damageMul` in force on that tick, with one exception: the aura
of Halo or Corona and each Chandelier lantern have their damage recomputed on
every tick. A Wick level gained later leaves every other live shape's damage
as it was. Contact damage the lamplighter takes is governed by armor alone,
under Armor below.

### Cooldown

A weapon's cooldown is its table `cooldown` times `cooldownMul`, floored at
`MIN_COOLDOWN` (`0.2`) seconds: `cooldown = max(MIN_COOLDOWN, table cooldown ×
cooldownMul)`. For Halo and Corona the table `cooldown` is the pulse interval
of the aura, and for Flare it is the interval between bursts; both scale the
same way. Chandelier has no cooldown, so cooldownMul reads nothing from it.

A weapon's timer is set from this value each time the weapon fires, and a timer
already counting keeps the value it was set with.

The intervals a weapon fixes by a named constant are used as written:
`OIL_PULSE`, `BLAZE_PULSE`, `LANTERN_REHIT`, `SHARD_REHIT`, and `SCONCE_REHIT`.

### Area

`areaMul` scales every length a weapon's table or stat row gives for the shape
it hits with. The scaled length is the table value times `areaMul`, and a
projectile's collision radius is a scaled length like any other. A shape's
lengths are fixed when it is created, with one exception: the Halo and Corona
aura's radius and a Chandelier lantern's orbit and radius are recomputed on
every tick from the level and `areaMul` in force on that tick.

| Weapon                   | Lengths scaled by `areaMul`   |
| ------------------------ | ----------------------------- |
| Taper, Pyre              | slash `width`, slash `height` |
| Ember, Pin, Beacon, Hail | bolt `radius`                 |
| Lantern, Chandelier      | `orbit`, lantern `radius`     |
| Halo, Corona             | aura `radius`                 |
| Oil Splash, Blaze        | puddle `radius`               |
| Spark                    | strike `area`                 |
| Shard, Sconce            | bolt `radius`                 |
| Flare                    | burst `radius`                |

Every other length a weapon uses is used as written: `SPARK_RANGE`,
`OIL_SCATTER`, `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`. The
lamplighter's own `PLAYER_RADIUS` and every enemy radius are likewise fixed.

### Armor

Armor is a flat reduction to each contact hit the lamplighter takes:

```
damage taken = max(MIN_DAMAGE_TAKEN, enemy damage − armor)
```

with `MIN_DAMAGE_TAKEN` (`1`), so every contact hit that lands removes at least
`1` health whatever the armor. Brass tops out at level `3`, so armor is at most
`3`.

### Amount

A weapon's amount is its table `amount` plus `amountBonus`, so at Mirror level
`2` every weapon that counts projectiles, puddles, strikes, or lanterns fires
two more of them. The weapons whose stat row carries an `amount` all take the
bonus, Beacon, Hail, Chandelier, and Blaze included.

Halo, Corona, and Flare have no amount and ignore `amountBonus`. Taper and
Pyre have two sides, so their amount is capped at `TAPER_MAX_AMOUNT` (`2`) and
any bonus past it adds nothing.

### Move speed

The lamplighter's move speed is `MOVE_SPEED` (`180`) times `speedMul`, in units
per second, and the movement rule in `specs/world.md` integrates that speed
each tick. Diagonal speed equals cardinal speed at every Bellows level.

### Max health

`maxHp` is `BASE_MAX_HP` (`100`) plus `TALLOW_HP_PER_LEVEL` per Tallow level.
Each time Tallow rises by one level, whether it is gained at level `1` or
leveled from any level below its max, and through whichever path grants it,
the lamplighter's current `hp` rises by `TALLOW_HP_PER_LEVEL` on the same tick
that `maxHp` does. Every heal and every recovery tick caps `hp` at the `maxHp`
in force when it is applied.

### Recovery

`recovery` is `BASE_RECOVERY` (`0`) plus `TINDER_RECOVERY_PER_LEVEL` per
Tinder level, in health per second. On every tick of the `playing` screen:

```
hp = min(maxHp, hp + recovery × TICK_DT)
```

with `TICK_DT` (`1/60`) seconds. Recovery is continuous rather than periodic.

### Experience

The experience a collected gem grants is `GEM_VALUES[tier]` times `xpMul`, a
real number added to `xp` on the tick the gem is collected. The level-up rule
in `specs/progression.md` reads `xp` as that real number. Gems are the only
source of experience.

### Pickup radius

The radius within which a gem becomes attracted is `PICKUP_RADIUS` (`48`)
times `pickupMul`, measured from the lamplighter's center to the gem's. The
attraction rule in `specs/world.md` reads this radius on every tick, so a
gem that was outside the base radius is picked up on the first tick Lure
brings it inside. Chest, bread, and draft are collected on contact, at the
fixed distance `specs/world.md` states.

## What passives leave as written

Every figure a passive does not name above is used exactly as its table or
constant states it. Projectile `speed` and `duration` are used as written for
every weapon, at every passive level, so a bolt travels the same distance and
a lantern, puddle, shard, or sconce lasts the same time whatever the passives
held. `pierce`, every re-hit interval, every pulse interval, and every enemy
figure are likewise fixed.
