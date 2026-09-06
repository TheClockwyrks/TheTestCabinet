# Wick — Evolutions

This file defines the six evolved weapons: the recipe that produces one, what
an evolution replaces, and each evolved form's behavior and fixed stats. An
evolved weapon is a base weapon from `specs/weapons.md` in a stronger, final
form; it reads every common rule of that file unchanged. Chests, the pickup
that triggers an evolution, are in `specs/world.md`, and the chest overlay
is in `specs/ui.md`.

## The recipe

A base weapon is eligible to evolve when all three hold at once:

- it is held at `MAX_WEAPON_LEVEL` (`8`);
- the passive its recipe names is held, at any level;
- the player opens a chest.

The recipes are `EVOLUTIONS`, keyed by the evolved weapon's id; the six ids
are `EVOLUTION_IDS`, in this order, with display names in `WEAPON_NAMES`.

| Evolution | Id | From | Passive |
| --- | --- | --- | --- |
| Pyre | `pyre` | Taper | Wick |
| Beacon | `beacon` | Ember | Oil |
| Hail | `hail` | Pin | Mirror |
| Chandelier | `chandelier` | Lantern | Glass |
| Corona | `corona` | Halo | Tinder |
| Blaze | `blaze` | Oil Splash | Soot |

## Opening a chest

A chest is collected as `specs/world.md` states, and the overlay it opens is
in `specs/progression.md`. Its result is decided by the first of these rules
that applies:

1. Evolution. The held weapons are checked in slot order, first slot first,
   and the first base weapon at `MAX_WEAPON_LEVEL` whose recipe passive is
   held at any level evolves. A base weapon with no recipe never evolves: at
   `MAX_WEAPON_LEVEL` a chest passes it over, and it is neither evolved nor
   leveled. One chest evolves at most one weapon. The
   evolved weapon replaces its base in the same slot with a single level, its
   cooldown timer is set to `0` so it fires on the first `playing` tick it is
   held, the passive stays held, and the `evolve` cue plays. The result is
   `{ kind: "evolve", weapon }`.
2. Level. One held item below its max level, a base weapon below
   `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen uniformly at
   random and rises by `1`, exactly as accepting a `+1 level` offer does. The result is
   `{ kind: "level", item, level }`, with `level` the level it became.
3. Heal. `hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`. The result is
   `{ kind: "heal" }`.

## What an evolution is

Six of the ten base weapons have an evolved form; Spark, Shard, Sconce, and
Flare have none and top out at `MAX_WEAPON_LEVEL`. An evolved weapon has a
single level and no level table: its figures are one fixed row, named below,
and it is never leveled further. It is never a
level-up offer, and it is never the item a chest levels. The base weapon it
replaced is gone from the loadout, and while the evolved weapon is held that
base weapon is not a level-up candidate either. On the HUD the slot shows the
evolved weapon's icon in place of the base weapon's.

## Passives still apply

Every derived stat of `specs/passives.md` applies to an evolved weapon exactly
as to a base weapon, read on the tick the weapon fires: damage is the fixed
damage times `damageMul`; cooldown is the fixed cooldown times `cooldownMul`,
floored at `MIN_COOLDOWN` (`0.2`); every width, height, radius, and orbit is
the fixed length times `areaMul`; and amount is the fixed amount plus
`amountBonus`. Speed, pierce, duration, and the re-hit and pulse intervals are
used as written. A shape's lengths and its damage are fixed when it is
created, except the Corona aura's radius and damage and a Chandelier lantern's
orbit, radius, and damage, which are recomputed on every tick from the
`areaMul` and `damageMul` in force on that tick.

## Pyre

Pyre is Taper's slash on both sides of the player on every firing: two
rectangles of `width × height`, one extending `width` in the facing direction
from the player's `x` and one mirrored to the opposite side, each centered
vertically on the player's `y`, each hitting on the tick it fires alone and
drawn for `SLASH_FLASH` (`0.1`) seconds. Its amount is `2` plus
`amountBonus`, capped at `TAPER_MAX_AMOUNT` (`2`), so both sides always fire
and nothing more.

Each enemy a Pyre slash hits heals the player `PYRE_HEAL` (`1`) health on
the tick of the hit, capped at `maxHp`. The fixed row is `PYRE_STATS`.

| Damage | Cooldown | Width | Height | Amount |
| --- | --- | --- | --- | --- |
| 60 | 1.2 | 200 | 60 | 2 |

## Beacon

Beacon is Ember's bolt: a circle of `radius` fired from the player's center at
`speed` toward the nearest enemy on the tick of firing, flying straight and
removed after `duration` seconds, with the row's `pierce`. With amount `n`, `n`
bolts fire on the same tick at the `n` nearest distinct enemies, fewer when
fewer exist, and Beacon needs at least one enemy to fire. The fixed row is
`BEACON_STATS`.

| Damage | Cooldown | Speed | Radius | Pierce | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 0.25 | 500 | 10 | 2 | 2.0 | 1 |

## Hail

Hail is Pin's dart: a circle of `radius` fired horizontally in the facing
direction at `speed`, removed after `duration` seconds, with the row's
`pierce`, fired whether or not any enemy exists. Amount `n` darts fire on the
same tick, dart `i` counted from `0` starting at `x = player.x` and
`y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with `PIN_SPREAD` (`10`). The
fixed row is `HAIL_STATS`.

| Damage | Cooldown | Speed | Radius | Pierce | Duration | Amount |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | 0.5 | 700 | 7 | 3 | 1.5 | 6 |

## Chandelier

Chandelier is Lantern's orbit made permanent: its lanterns never vanish, and it
has no cooldown and no duration, so its slot's cooldown timer holds `0`. On
the first `playing` tick Chandelier is held and no Chandelier lantern exists,
any Lantern lanterns still in the world are removed and `amount` Chandelier
lanterns are created, each a zone of kind `lantern` with `ttl` `null`, a fresh
id, and empty `hits`, on a circle of radius `orbit` centered on the player's
center, lantern `i`, counted from `0`, at angle `i × 360 / amount`. From the
next tick they revolve at `LANTERN_ANGULAR_SPEED` (`180`) degrees per second
clockwise, the circle they ride centered on the player's center every tick,
and `orbit`, each lantern's `radius`, and each lantern's `damage` are
recomputed on every tick from the `areaMul` and `damageMul` in force on that
tick. The set is removed on the next `playing` tick Chandelier is no longer
held.

On any tick on which `amount` differs from the number of Chandelier lanterns
in the world, the lanterns are replaced by `amount` new zones with fresh ids
and empty `hits`, lantern `i` at `i × 360 / amount` degrees from the angle the
lowest-id lantern held.

Each lantern is a touching effect with re-hit interval `LANTERN_REHIT`
(`0.5`), timed per lantern per enemy. The fixed row is `CHANDELIER_STATS`.

| Damage | Orbit | Radius | Amount |
| --- | --- | --- | --- |
| 25 | 120 | 20 | 4 |

## Corona

Corona is Halo's aura: one zone of kind `aura`, a circle of `radius` centered
on the player's center every tick, its `radius` and `damage` recomputed on
every tick from the `areaMul` and `damageMul` in force on that tick. On the
first `playing` tick Corona is held and no Corona aura exists, the Halo aura
zone is removed and the Corona zone is created with a fresh id, and the zone is
removed on the next `playing` tick Corona is no longer held. Corona pulses on
its first tick and on every tick its cooldown timer is due; each pulse deals
`damage` to every enemy whose circle overlaps the aura, and amount is ignored.
Corona keeps the `hum` loop that Halo carried, as `specs/ui.md` states.

Each enemy a pulse kills, one whose `hp` the pulse's own hit takes from above
`0` to `0` or below, heals the player `CORONA_HEAL` (`1`) health on that tick,
capped at `maxHp`; an enemy another shape of the same tick already took to
`0` or below heals nothing. The fixed row is `CORONA_STATS`, where the cooldown
is the pulse interval.

| Damage | Cooldown | Radius |
| --- | --- | --- |
| 12 | 0.5 | 150 |

## Blaze

Blaze is Oil Splash's puddles: on each firing, `amount` puddles appear, each
centered at an independent uniformly random point of the disk of radius
`OIL_SCATTER` (`400`) about the player's center, each a circle of `radius`
that stays where it landed for `duration` seconds. Blaze fires whether or not
any enemy exists.

A Blaze puddle is a pulsing effect with interval `BLAZE_PULSE` (`0.2`): it
pulses on the tick it appears and on every `BLAZE_PULSE` interval of ticks
after, and each pulse deals `damage` to every enemy overlapping it. The fixed
row is `BLAZE_STATS`.

| Damage | Cooldown | Radius | Duration | Amount |
| --- | --- | --- | --- | --- |
| 8 | 2.0 | 70 | 4.0 | 5 |
