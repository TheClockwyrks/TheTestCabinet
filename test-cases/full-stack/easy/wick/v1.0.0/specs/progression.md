# Wick — Progression

This file defines how a run grows: the slots the lamplighter's weapons and
passives sit in, the experience curve and the level-ups it produces, the
level-up overlay and the offers it draws, and the chest overlay. The weapon
tables are in `specs/weapons.md`, the evolution recipes, the evolved weapons,
and what a chest's result is in `specs/evolutions.md`, the derived stats
through which every passive acts in `specs/passives.md`, and the copy each
overlay shows in `specs/ui.md`. Every figure below carries the name this
specification gives it.

## Slots

| Figure | Constant | Value |
| --- | --- | --- |
| Weapon slots | `WEAPON_SLOTS` | `6` |
| Passive slots | `PASSIVE_SLOTS` | `6` |
| Max level of a base weapon | `MAX_WEAPON_LEVEL` | `8` |

A weapon slot holds one weapon at one level, and a passive slot holds one
passive at one level. An item enters the first free slot of its kind at level
`1` and keeps that slot for the rest of the run, so slot order is acquisition
order. A base weapon levels up to `MAX_WEAPON_LEVEL`; a passive levels up to
its own max level, given in `specs/passives.md`; an evolved weapon has a
single level and replaces its base weapon in the same slot, as
`specs/evolutions.md` states.

A run starts with Taper at level `1` in the first weapon slot, every other slot
empty, `level` `1`, and `xp` `0`.

## Levels and experience

| Figure | Constant | Value |
| --- | --- | --- |
| Experience to leave level 1 | `XP_BASE` | `5` |
| Increase per level | `XP_STEP` | `10` |

`level` starts at `1` and `xp` is a real number that starts at `0`. The
experience needed to leave a level is:

```
xpToNext(level) = XP_BASE + XP_STEP × (level - 1)
```

| Level | `xpToNext(level)` | Total collected since level 1 |
| --- | --- | --- |
| 1 | 5 | 5 |
| 2 | 15 | 20 |
| 3 | 25 | 45 |
| 4 | 35 | 80 |
| 5 | 45 | 125 |
| 6 | 55 | 180 |
| 7 | 65 | 245 |
| 8 | 75 | 320 |
| 9 | 85 | 405 |
| 10 | 95 | 500 |

The last column is the experience collected over a run at which that level is
left, so a lamplighter reaches level `11` after collecting `500` experience.

Experience arrives from gems alone, each adding `GEM_VALUES[tier] × xpMul` on
the tick it is collected, as `specs/world.md` states. After every gain, while
`xp >= xpToNext(level)`: `xp` falls by `xpToNext(level)`, `level` rises by `1`,
and one level-up is queued in `pendingLevelUps`. The overflow carries into the
next level, and one gem can queue several level-ups when it carries enough
experience for them.

## The level-up overlay

A `playing` tick that ends with `pendingLevelUps` above `0` runs to completion
and then opens the overlay: `screen` becomes `levelup` with `menuIndex` `0`.
The overlay therefore opens on the same tick the first level-up is queued, and
the simulation does not tick while it is open, so the world behind it is
frozen exactly as that tick left it.

Two kinds of tick open no level-up overlay. A tick that ends the run ends it
and opens no overlay, chest or level-up. A tick that collects a chest opens the
chest overlay instead, and the level-ups queued on that tick open their overlay
at the end of the next `playing` tick.

### The candidate pool

The pool is computed each time a level-up overlay opens, from the slots as they
stand at that moment. It holds:

- every held base weapon below `MAX_WEAPON_LEVEL`, and every held passive
  below its max level, each as a `+1 level` offer;
- when a weapon slot is free, every base weapon not held whose evolution is
  not held, each as a new item;
- when a passive slot is free, every passive not held, each as a new item.

The base weapons are the ten in `BASE_WEAPON_IDS`, and the evolution of each
is given by `EVOLUTIONS` in `specs/evolutions.md`. An evolved weapon is never
a candidate, and neither is the base weapon it came from.

### The draw

| Figure | Constant | Value |
| --- | --- | --- |
| Offers per overlay | `OFFER_COUNT` | `3` |
| The fallback offer's id | `LAMP_OIL_ID` | `lamp-oil` |
| Its display name | `LAMP_OIL_NAME` | `Lamp Oil` |
| Health it restores | `LAMP_OIL_HEAL` | `30` |

The overlay offers `OFFER_COUNT` distinct candidates drawn uniformly at random
from the pool without replacement, using the game's seeded random generator,
and every candidate in a pool smaller than `OFFER_COUNT` is offered. When the
pool is empty the overlay offers exactly one item, `LAMP_OIL_ID`, which fills
no slot. `offers` holds the drawn ids in the order they are listed.

### Choosing

The offers are listed vertically in the order of `offers`, and the item at
`menuIndex` is highlighted. `up` and `down` move the highlight by one and wrap
at both ends, and `confirm` accepts the highlighted offer. Each offer shows the
item's icon, its display name, and a tag: `OFFER_NEW_TEXT` (`NEW`) for an item
not yet held, otherwise `LEVEL_LABEL` (`LEVEL`) followed by the level the item
would become. Lamp oil is never held, so its tag is `NEW`. Beneath the offer
list the overlay shows, on one line, the description of the offer at
`menuIndex`: a weapon's from `WEAPON_DESCRIPTIONS`, a passive's from
`PASSIVE_DESCRIPTIONS`, and lamp oil's `LAMP_OIL_DESCRIPTION`. `specs/ui.md`
fixes the text of each.

Accepting an offer applies it on the spot:

| Offer | Effect |
| --- | --- |
| A weapon or passive not held | It enters the first free slot of its kind at level `1`. A weapon's cooldown timer starts at `0`, so it fires on the first `playing` tick it is held. |
| A held weapon or passive | Its level rises by `1`. Its table row and its derived-stat terms read the new level from the next tick; a weapon's running cooldown timer keeps counting. |
| `lamp-oil` | `hp` rises by `LAMP_OIL_HEAL`, capped at `maxHp`. |

Gaining a Tallow level raises `hp` by `TALLOW_HP_PER_LEVEL` (`15`) at the same
time as `maxHp`, whichever path grants it. Accepting decrements
`pendingLevelUps`. When level-ups remain queued the next overlay opens
immediately, with a fresh pool drawn from the slots as the acceptance left
them; otherwise `screen` returns to `playing` and the simulation resumes on the
next tick.

## The chest overlay

A chest is collected as `specs/world.md` states. On the tick it is collected
the tick runs to completion, the chest's result is applied as
`specs/evolutions.md` states, `chestResult` records it, and `screen` becomes
`chest` with `menuIndex` `0`. The simulation does not tick while the overlay
is open; `confirm` closes it, setting `chestResult` to `null` and `screen` to
`playing`. Level-ups queued on the tick that collected the chest open their
overlay at the end of the next `playing` tick.

The overlay shows which of the three results happened: the evolved weapon's
icon and name, or the item that leveled and its new level, or the heal, under
the heading `specs/ui.md` gives.
