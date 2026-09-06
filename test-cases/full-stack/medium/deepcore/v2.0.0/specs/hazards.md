# Deepcore — Hazards

This file defines the dangers of the mine: gas pockets, lava, fall impact, and the
unstable Core Sample. There are no enemies; the mine itself is the adversary.
Every figure below carries the name this specification gives it.

## Gas pockets

A gas pocket is a minable cell filled with volatile gas. It takes drill hits
exactly as its band's rock does, spending the same time and fuel, but when its
health reaches `0` it detonates instead of clearing cleanly. The cell becomes an
open tunnel either way.

| Quantity                                                 | Name              | Value                  |
| -------------------------------------------------------- | ----------------- | ---------------------- |
| Damage where gas first appears, at depth fraction `0.25` | `GAS_DAMAGE_MIN`  | `60` hull              |
| Damage at the deepest minable row                        | `GAS_DAMAGE_MAX`  | `400` hull             |
| Radius within which the miner is hit                     | `GAS_BLAST_TILES` | `1.5` tiles            |
| Speed the blast shoves the miner away at                 | `GAS_KNOCKBACK`   | `700` units per second |

A detonation at depth fraction `f` deals
`GAS_DAMAGE_MIN + (GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * max(0, f - 0.25) / 0.75`
hull to the miner when the miner's center is within `GAS_BLAST_TILES` of the
pocket's center, and nothing beyond that radius. The miner is shoved directly away
from the pocket at `GAS_KNOCKBACK`, the hurt state plays, the screen shakes, and
the produced gas-explosion effect and its cue fire.

Nothing reduces gas damage. Hull is the only counter, so the hull tier is what
makes the deep bands survivable.

An explosives blast detonates every gas pocket inside it, and a detonation
triggered that way is resolved exactly as a drilled one. Detonations chain within
the block.

A gas pocket is drawn as ordinary band rock. Its only tell is the produced gas
seep, a faint wisp rising from the cell. Seeps are emitted over the gas pockets
currently on screen in round-robin turn, so every visible pocket wisps within
`GAS_SEEP_PERIOD` (`2`) seconds and a player watching a suspect cell sees it
breathe.

## Lava

Lava appears from the deepstone band down and grows denser with depth, forming
pools rather than isolated cells.

| Quantity                                                                   | Name                   | Value |
| -------------------------------------------------------------------------- | ---------------------- | ----- |
| Hull drained per second while touching lava, before the radiator           | `LAVA_CONTACT_DPS`     | `32`  |
| Hull burned by drilling through a deepstone lava cell, before the radiator | `LAVA_DRILL_DEEPSTONE` | `60`  |
| Hull burned by drilling through a coreshell lava cell, before the radiator | `LAVA_DRILL_CORESHELL` | `100` |

- Contact drains hull at `LAVA_CONTACT_DPS` for as long as the miner's box
  overlaps a lava cell.
- A lava cell drills exactly like its band's rock, taking the same hits, time, and
  fuel, and clears to open tunnel. The lump above is dealt once, as the cell
  breaks.
- The contact drain is not charged on the cell currently being drilled: that
  cell's heat is the lump.
- The radiator tier's effectiveness reduces both the contact drain and the lump by
  that fraction.
- Lava does not flow or spread, so a route around a pool can be planned.

## Fall impact

A landing above a safe speed costs hull.

| Quantity                                             | Name                 | Value                  |
| ---------------------------------------------------- | -------------------- | ---------------------- |
| Landing speed below which a landing is harmless      | `IMPACT_SAFE_SPEED`  | `700` units per second |
| Hull per unit of downward speed above the safe speed | `IMPACT_DAMAGE_RATE` | `0.1`                  |

A landing at downward speed `v` deals
`max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE` hull, plays the hurt state
and the produced impact dust, and shakes the screen in proportion to the damage.
`IMPACT_SAFE_SPEED` covers a free fall of two tiles, so stepping off a ledge is
always harmless, while an unarrested fall to terminal speed costs a real bite of
hull, and more the heavier the haul, because the terminal speed itself rises with
the load.

## The unstable Core Sample

Drilling downward onto the Core in the Core chamber extracts a Core Sample into
the satchel and starts its destabilization timer at `CORE_TIMER` (`90`) seconds.

- The timer counts down in game time and never pauses while the expedition runs,
  at the surface, inside a panel, or in the inventory. The pause menu freezes the
  whole simulation, the timer with it, and resuming resumes it where it stopped.
- Installing the Ignition Core at the Launch Pad stops the timer and consumes the
  Sample.
- The timer expiring detonates the Sample. The produced core-detonation effect
  fires with a long screen shake.
- A detonation while the Sample is carried kills the miner outright.
- A detonation while the Sample lies jettisoned on the ground kills a miner whose
  center is within `CORE_BLAST_TILES` (`3`) tiles of the ground cell's center, and
  leaves a miner beyond that radius unharmed.
- The Sample is destroyed either way, and by any death while it is held. Every
  component already installed on the rocket stays installed.

Because the Core is inexhaustible, a lost Sample always means another trip down
rather than an unwinnable expedition.

## First-time hazard notices

The first gas detonation that damages the miner in an expedition, and the first
lava burn that does, each raise a one-time notice card explaining what happened
and how to deal with it. Each fires at most once per expedition and resets on a
fresh one.

- The card appears `NOTICE_DELAY` (`1.5`) seconds after the hit, so the
  detonation, the screen shake, and the hull drop land first.
- The card is drawn low in the viewport, clear of the miner.
- The card is non-blocking: the mine keeps running behind it, and it fades on its
  own after `NOTICE_FADE` (`8`) seconds. A pointer press or a touch on the card
  dismisses it at once.
