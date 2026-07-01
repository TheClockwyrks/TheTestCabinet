# Heat

## Overview

This file defines the signature Heat system of Meltdown: how an emitter's heat
drives its power, how pushing past the redline trips it offline, how the Forge
and Vent move heat between neighbors, and the three thermal stances the towers
fall into. **Read this file carefully.** It builds on the tile grid in
`specs/playfield.md` and is the rule that the towers in `specs/towers.md` are
all built on.

## Emitter Heating and Cooling Rates

Each emitter (every tower that fires — the six in `specs/towers.md`; the Forge
and Vent do not fire and have no heat of their own) carries a heat value `H`, a
number from `0` (stone cold) to `100` (the redline). Heat is shown on its
footprint and in the inspector (see `specs/playfield.md`), and it changes
continuously as the tower runs:

- **Firing heats it.** Each shot a tower fires adds its `heatPerShot` to
  `H`. A fast-firing or heavy-hitting tower piles on heat quickly; a slow one
  trickles it on.
- **Idling cools it.** At all times `H` also falls by the tower's `coolRate`
  per second (in heat units/second). So a tower with a target in range climbs
  (its firing outpaces its cooling); a tower with no target in range falls back
  toward `0`.
- Heat is clamped to `[0, 100]` and never goes negative.

A tower's per-type `heatPerShot` and `coolRate` are in `specs/towers.md`.
Whether a tower is heating or cooling at any moment is therefore a function of
how often it has a target in range — which is a function of how the surge
flows past it, which is a function of the maze the player built. Heat is
the bridge between the maze and the guns.

## Damage Scaling

An emitter **fires harder the hotter it runs.** Its damage per shot is its base
damage scaled by a heat multiplier that rises with `H` on an
accelerating curve:

```
damage = baseDamage * heatMultiplier(H)
heatMultiplier(H) = 1 + 2 * (H / 100)^2
```

So at `H = 0` a shot does **1.0x** base damage; at `H = 50`, **1.5x**; at `H =
80`, **2.28x**; and just under the redline, near `H = 100`, **3.0x** — its
highest damage value. The curve is quadratic, so the last stretch toward the
redline is where the real power is: a tower idling cold is feeble, and a tower
run right up near the redline is three times the base value. The visual glow
tracks this exactly — cold blue is weak, white-hot is lethal (see
`specs/overview.md`).

This is the central pull of Meltdown. To get a tower's damage you must keep it
hot, which means feeding it a steady stream of targets — but the same heat
that powers it is also what can take it offline.

## Redline and Tower Tripping

If a tower's heat reaches `100` (the 'redline'), it **trips**, after which the
following effects apply:

- The tower goes offline for a trip cooldown of `3.0 s` — it stops firing and
  deals no damage at all during that window.
- It is drawn unmistakably tripped: strobing red (`#ff3030`) so as to appear
  visibly dead.
- Its heat bleeds off to `0` over the cooldown, and when the `3.0 s` elapse it
  comes back online cold (`H = 0`) and begins heating again from scratch.

A tripped tower is a hole in your defense: for three seconds the surge are able
to walk past it untouched. Tripping is the **only** way an emitter fails —
towers are never destroyed, never damaged by the surge, and have no ammo or
other limit. The whole risk of running hot is the redline, and the whole skill
is riding up near it for the damage without tipping over.

Because firing rate (and thus heat gain) is driven by how many targets sit in
range, a tight kill-box where the surge is packed and a tower never stops
firing will climb to the redline and trip, while a tower with breathing room
between targets stays online but never gets as hot, resulting in lower damage.
Shaping the maze is choosing, tower by tower, where on that trade-off to sit —
and the Forge and Vent let you cheat it
locally.

## Thermal Modulation - Forge and Vent

Two structures do not fire at all; their entire job is to **move heat** to and
from the emitters next to them. Because every tower occupies a **2 x 2 tile
footprint** (`specs/playfield.md`), "next to" means two tower footprints touch
orthogonally along an edge. Diagonal corner contact does not couple heat.

Thermal coupling scales by how much of the two-tile edge is shared:

- **Fully aligned edge contact: 100% transfer.** For left/right neighbors, the
  towers have the same top and bottom rows, so their full vertical edges touch.
  For above/below neighbors, they have the same left and right columns, so their
  full horizontal edges touch.
- **Slightly staggered edge contact: 50% transfer.** The footprints touch along
  exactly one tile of edge. For left/right neighbors, this means the top row of
  one tower is the bottom row of the other; for above/below neighbors, the left
  column of one tower is the right column of the other.
- **No shared edge: 0% transfer.** Towers that only touch at a corner, overlap
  no edge tiles, or are separated by at least one tile do not exchange heat.

- **The Forge** *adds* heat to each adjacent emitter, continuously, every
  second it stands — its `forgeHeat` is multiplied by the coupling percentage
  above and poured into every orthogonal neighboring emitter's `H`. This is the
  double-edged structure: in a lull, a Forge keeps a neighbor warm and strong
  when it would otherwise cool to feeble; in a heavy push, that same constant
  heat stacks on top of the neighbor's own firing heat and can inadvertently
  push it over the redline, tripping it.
- **The Vent** *removes* heat from each adjacent emitter, continuously — its
  `ventCool` is multiplied by the coupling percentage above and subtracted from
  every orthogonal neighboring emitter's `H` each second, on top of that tower's
  own cooling. A Vent lets a tower that would otherwise trip be run **flat out**
  without tipping over: park a redline-prone emitter beside a Vent and it can
  fire continuously and stay online.

The exact `forgeHeat` and `ventCool` values, and how upgrading these structures
changes them, are in `specs/towers.md`. Coupling is **local** — only orthogonal
neighboring footprints with shared edge contact are affected — so where you
place a Forge or a Vent on the floor is as much a part of the puzzle as where
you place the guns. Heat does not otherwise spread between emitters: an ordinary
emitter does not heat or cool its neighbors, only the Forge and Vent do.

## Tower Heat Relationships

Every tower relates to heat in one of three ways. Reading the floor helps
understand what each tower wants:

- **Heat-hungry** — most emitters (the Arc, Stutter, Lance, Bloom, and Flak of
  `specs/towers.md`). They follow the rule above: hotter means more damage, up
  to the redline, where they trip. They *want* heat, but fear the cliff — so
  they want a steady stream of targets, and a Vent nearby if they run too hot
  or a Forge nearby if they run too cold.
- **Heat-averse** — the cryo Rime. It runs the rule **backward**: heat does not
  power it, heat **degrades** it. The Rime slows the surge best when it is
  cold, and its slow weakens as it heats (see `specs/towers.md` for the exact
  curve). It still trips at the redline like any emitter, but you almost never
  want it near one: keep a Rime isolated or beside a Vent, away from Forges and
  hot cores, so it stays cold and slows hard.
- **Heat-movers** — the Forge (a source) and the Vent (a sink). They have no
  heat of their own and never fire; they exist only to push heat into or pull
  heat out of their neighbors, so you can reconcile the hungry and the averse
  on the same floor.

The maze sets each tower's baseline heat — packed lanes run hot, open lanes run
cold — and the movers let you override that baseline tile by tile. A good floor
is a deliberate thermal landscape: a white-hot core held just under the redline
by Vents, a Forge keeping a slow gun fed, and a cold cryo pocket off on its own
— with the surge threaded through all of it.
