# Arc Foundry — Components

A component is a salvaged electrical part that walls its footprint and, for all but one
type, fires at the Load. This file fixes the eight base types, the abilities they carry,
the five-rung quality ladder that scales them, the rules every firing structure obeys,
and the full stat tables. The twelve combination towers are in `specs/combinations.md`,
and how a component comes to exist is in `specs/scrap-press.md`.

Ranges and radii are in the logical units of `specs/overview.md`. Damage and health are
unitless. Every stat table below is fixed; implement it exactly.

## The eight base types

| Type | Identifier | What it does |
| --- | --- | --- |
| Capacitor | `capacitor` | A balanced single-target bolt. |
| Coil | `coil` | A bolt that chains to nearby further targets. |
| Emitter | `emitter` | A rapid, very low-damage single-target spark. |
| Arc-Node | `arcnode` | A shot that discharges over an area at its impact point. |
| Discharge Rig | `discharge` | A slow, long-range, heavy single-target bolt. |
| Choke | `choke` | A low-damage single-target bolt that slows the unit it strikes. |
| Rectifier | `rectifier` | A low-damage single-target bolt that sets a burn on the unit it strikes. |
| Regulator | `regulator` | A support node that never fires and projects a damage aura. |

Seven of the eight fire. The Regulator never fires: it has no range, no damage, no firing
head, no projectile, and no targeting priority, and its aura is its whole reach. It still
occupies and walls its footprint, is still a keepable candidate, and is still a recipe
ingredient.

## Abilities

Beyond raw damage a structure may carry abilities. `specs/enemies.md` fixes what a slow
and a burn do to the unit that carries them; this section fixes what applies them.

| Ability | Effect |
| --- | --- |
| slow | On impact, applies a slow of the stated amount for the stated duration to the struck unit. |
| burn | On impact, applies a burn of `shotDamage * frac` per second for the stated duration to the struck unit. |
| crit | Each shot has the stated chance to deal `critMult` times its damage instead of its damage. The roll comes off the game's seeded generator. |
| multishot | Each cadence the structure fires at up to `N` distinct in-range units instead of one, choosing the top `N` by its targeting priority, each as its own projectile. |
| aura | Every firing structure whose center lies within `auraRadius` of the source deals `1 + auraBonus` times its damage. |

- `crit` and `multishot` are carried by combination towers only. No base component crits
  or multishots.
- Aura bonuses from several sources covering one structure sum, and the summed bonus is
  capped at `AURA_CAP` (`1.0`, doubling the structure's damage). An aura never buffs its
  own source, and it changes damage alone: range, cadence, and every ability parameter
  are untouched by it.
- An aura-buffed damage figure is not rounded.
- Aura coverage is recomputed whenever the set of structures on the yard changes.

## The quality ladder

Every base component carries a quality tier on a five-rung ladder. `QUALITY_TIERS` holds
the five in order.

| Tier | Name | Identifier | Reads as |
| --- | --- | --- | --- |
| `1` | Scrap | `scrap` | Pitted, rusted, a dim flicker |
| `2` | Tuned | `tuned` | Cleaned, a steady glow |
| `3` | Charged | `charged` | Polished, bright, humming |
| `4` | Primed | `primed` | Machined, arcing at rest |
| `5` | Tesla-Prime | `teslaprime` | Mirror-chromed, wreathed in continuous arcs |

A base component is always a type at a quality. A combination tower has no quality tier.

## How quality scales a component

| Stat | Rule |
| --- | --- |
| Damage | `baseDamage * QUALITY_MULT[tier]`, where `QUALITY_MULT` is `[1, 3, 9, 40, 110]`. |
| Range | `baseRange + RANGE_PER_TIER * (tier - 1)`, where `RANGE_PER_TIER` is `8`. |
| Fire rate | Flat. A type's cadence is the same at every tier. |
| Footprint | Flat, `2` by `2` tiles at every tier. |
| Signature numbers | Step up with tier per type, in the tables below. |

The Regulator has neither damage nor range, so the first two rules do not apply to it.
Quality scales its aura radius and bonus instead.

## Firing and targeting

These rules apply to every firing structure, the seven firing base types and all twelve
combination towers.

- Range is a radius measured from the center of the structure's footprint. A unit whose
  position lies within that radius is a valid target, ground or flying.
- A structure fires at its fire rate, in shots per second, whenever it has a valid target
  in range, and holds fire otherwise.
- Every firing structure carries a targeting priority, chosen by the player and changed
  at any time. `TARGETING_PRIORITIES` holds the five, and every firing structure defaults
  to `first`.

| Priority | Selects the in-range unit that is |
| --- | --- |
| `first` | Furthest along the chain, by the progress ordering of `specs/pathing.md`. |
| `last` | Least far along the chain, by the same ordering. |
| `nearest` | At the shortest straight-line distance from the structure's center. |
| `strongest` | Carrying the most remaining health. |
| `weakest` | Carrying the least remaining health. |

Ties resolve toward the unit further along the chain, so the choice is deterministic.
Changing a priority costs nothing and takes effect on the next shot.

- A structure with chain, splash, or multishot picks its primary target, or its top `N`
  targets, by this same priority.
- A firing structure's head rotates to face the unit it is firing at and holds its last
  heading while it holds fire. The Regulator has no head and does not rotate.
- Every shot is a traveling projectile, and the projectile carries the hit. On firing,
  the structure launches a projectile from its center at `PROJECTILE_SPEED` (`520`)
  units per second, which travels toward its target's current position each update. When
  the projectile comes within `PROJECTILE_HIT_R` (`6`) of that position it applies its
  damage and any ability the shot carries, and is removed. A projectile whose target is
  removed before it arrives is removed with it and deals nothing.

## Base stats

`BASE_STATS` holds each type's Scrap-tier stats, which every higher tier scales from.

| Type | Range | Fire rate | Damage | Firing behavior |
| --- | --- | --- | --- | --- |
| Capacitor | `100` | `1.6` /s | `6` | Single target |
| Coil | `110` | `1.0` /s | `5` | Chains from the impact point |
| Emitter | `88` | `4.5` /s | `2` | Single target |
| Arc-Node | `96` | `0.85` /s | `5` | Splash at the impact point |
| Discharge Rig | `160` | `0.5` /s | `18` | Single target |
| Choke | `104` | `1.3` /s | `3` | Single target, applies slow |
| Rectifier | `96` | `1.1` /s | `2` | Single target, applies burn |
| Regulator | — | — | `0` | Does not fire |

### The Coil's chain

The Coil's projectile hits its primary target, then the hit leaps to the nearest unit not
yet struck by that shot within `COIL_LEAP_RANGE` (`70`) of the last unit struck, and
again from there. Each leap deals `COIL_FALLOFF` (`0.7`) times the previous hit's damage,
so the primary takes full damage, the first leap `0.7` of it, the second `0.49`, and so
on. A leap that finds no unstruck unit in range ends the chain.

`COIL_LEAPS` holds the maximum number of additional leaps by tier:

| Tier | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- |
| Additional leaps | `2` | `2` | `3` | `3` | `4` |

### The Arc-Node's splash

The Arc-Node's projectile discharges at its impact point, dealing the shot's full damage
to every unit, ground or flying, whose position lies within the splash radius of that
point. Damage is flat inside the radius, with no falloff.

`ARCNODE_SPLASH` holds the radius by tier, `42` at Scrap and `5` more per tier:

| Tier | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- |
| Splash radius | `42` | `47` | `52` | `57` | `62` |

### The Choke's slow

The Choke's hit applies a slow for `CHOKE_SLOW_DUR` (`1.2`) seconds. `CHOKE_SLOW` holds
the amount by tier, `0.22 + 0.03 * (tier - 1)`:

| Tier | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- |
| Slow amount | `0.22` | `0.25` | `0.28` | `0.31` | `0.34` |
| Speed while slowed | `0.78` | `0.75` | `0.72` | `0.69` | `0.66` |

### The Rectifier's burn

The Rectifier's hit applies a burn of `shotDamage * RECTIFIER_BURN_FRAC` (`0.5`) per
second for `RECTIFIER_BURN_DUR` (`2.0`) seconds. The fraction is flat at every tier, and
because the shot's damage climbs with the tier the burn climbs with it.

### The Regulator's aura

The Regulator projects an aura over every firing structure whose center lies within its
radius. `REGULATOR_AURA` holds the radius and bonus by tier,
`radius = 90 + 6 * (tier - 1)` and `bonus = 0.10 + 0.03 * (tier - 1)`:

| Tier | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- |
| Aura radius | `90` | `96` | `102` | `108` | `114` |
| Damage bonus | `+10%` | `+13%` | `+16%` | `+19%` | `+22%` |

## Damage by type and tier

Damage per shot, `baseDamage * QUALITY_MULT[tier]`. The Regulator has no damage row.

| Type | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- |
| Capacitor | `6` | `18` | `54` | `240` | `660` |
| Coil | `5` | `15` | `45` | `200` | `550` |
| Emitter | `2` | `6` | `18` | `80` | `220` |
| Arc-Node | `5` | `15` | `45` | `200` | `550` |
| Discharge Rig | `18` | `54` | `162` | `720` | `1980` |
| Choke | `3` | `9` | `27` | `120` | `330` |
| Rectifier | `2` | `6` | `18` | `80` | `220` |

For the Coil this is the primary hit's damage, and each leap scales from it. For the
Arc-Node it is dealt to every unit inside the splash radius. For the Choke and the
Rectifier it is the direct hit, with the slow or the burn applied on top.

## Range by type and tier

Range, `baseRange + 8 * (tier - 1)`. The Regulator has no range row; its reach is its
aura radius.

| Type | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- |
| Capacitor | `100` | `108` | `116` | `124` | `132` |
| Coil | `110` | `118` | `126` | `134` | `142` |
| Emitter | `88` | `96` | `104` | `112` | `120` |
| Arc-Node | `96` | `104` | `112` | `120` | `128` |
| Discharge Rig | `160` | `168` | `176` | `184` | `192` |
| Choke | `104` | `112` | `120` | `128` | `136` |
| Rectifier | `96` | `104` | `112` | `120` | `128` |

## Tallies

Every firing structure keeps two running tallies for the run: the number of units it
killed, and the total damage it dealt. Burn damage counts toward the tallies of the
structure that applied the burn. The tallies feed the inspector and the damage
leaderboard of `specs/hud.md`.
