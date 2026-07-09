# Heat

## Overview

This file defines the signature Heat system of Meltdown: how an emitter's heat
drives its power, how pushing past the redline trips it offline, how the Forge
and Sink move heat between neighbors, and the three thermal stances the towers
fall into. **Read this file carefully.** It builds on the tile grid in
`specs/playfield.md` and is the rule that the towers in `specs/towers.md` are
all built on.

## Emitter Heating and Cooling Rates

Each emitter (every tower that fires — the six in `specs/towers.md`; the Forge
and Sink do not fire and have no heat of their own) carries a heat value `H`, a
number from `0` (stone cold) to `100` (the redline). Heat is shown on its
footprint and in the inspector (see `specs/playfield.md`), and it changes
continuously as the tower runs:

- **Firing heats it.** Each shot a tower fires adds its `heatPerShot` to
  `H`. A fast-firing or heavy-hitting tower piles on heat quickly; a slow one
  trickles it on.
- **Cooling scales with heat.** At all times `H` also falls by `coolRate * (H /
  100)` per second — so `coolRate` is the tower's cooling rate *at the redline*
  (`H = 100`), and it tapers off as the tower cools: a near-cold tower barely
  cools, a near-redline tower cools hard. Firing adds a roughly fixed amount
  while cooling grows with heat, so a tower that keeps firing does **not** climb
  forever — it settles toward a stable **ceiling** where the two balance.
- Heat is clamped to `[0, 100]` and never goes negative.

For an unaided emitter firing continuously, that ceiling is:

```
H* = 100 * firingHeat / coolRate        (firingHeat = fireRate * heatPerShot)
```

If `H*` is above `100` the tower climbs past the redline and **trips** (below);
if `H*` is at or below `100` it settles there and runs on. A tower that only has
a target part of the time settles **proportionally lower** — so the hotter a
tower runs is a direct read on how busy its lane is.

The stats in `specs/towers.md` are tuned so that **most emitters' lone,
un-upgraded ceilings sit above `100`**: a gun that has a target essentially all
the time — jammed into a saturated lane — climbs past the redline and **trips**,
while the same gun with breathing room between targets settles below `100`, hot
but online. Placement is therefore the lever: keep a gun off the busiest tiles,
or give it a Sink, to run it hot without tripping. Two emitters are deliberate
exceptions: the **Stutter** trips the easiest (its ceiling is far above `100`),
and the **Lance** runs cold (its ceiling is *below* `100`, so it cannot trip on
its own and instead wants a Forge — `specs/towers.md`). Upgrades and a Forge
raise a ceiling further; a Sink lowers it. The Forge and Sink shift this ceiling
(below).

A tower's per-type `heatPerShot` and `coolRate` are in `specs/towers.md`.
Whether a tower is hot or cold at any moment is therefore a function of how
often it has a target in range — which is a function of how the surge flows
past it, which is a function of the maze the player built. Heat is the bridge
between the maze and the guns.

## Damage Scaling

An emitter **fires harder the hotter it runs.** Its damage per shot is its base
damage scaled by a heat multiplier that rises with `H` on an
accelerating curve:

```
damage = baseDamage * heatMultiplier(H)
heatMultiplier(H) = 0.5 + 2.5 * (H / 100)^2
```

So at `H = 0` a shot does only **0.5x** base damage; at `H = 50`, **1.13x**; at
`H = 80`, **2.1x**; and just under the redline, near `H = 100`, **3.0x** — its
highest damage value. The curve is quadratic, so the last stretch toward the
redline is where the real power is: a cold tower is genuinely **feeble** — barely
half its base damage — and a tower run right up near the redline is three times
the base value. The visual glow tracks this exactly — cold blue is weak,
white-hot is lethal (see `specs/overview.md`).

This is the central pull of Meltdown. Because a cold gun is half-strength,
keeping a tower hot is not a bonus but a requirement to pull real damage — which
means feeding it a steady stream of targets, or a **Forge** to warm a gun whose
lane runs too quiet. But the same heat that powers it is also what can take it
offline.

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
range, a tight kill-box where the surge is packed keeps a tower firing almost
continuously and drives it up past its ceiling to the redline, where it **trips**
— while a tower with breathing room between targets settles below its ceiling,
hot but online. That is the core trade-off: the busiest tiles give the most
damage but risk the trip, and shaping the maze is choosing, tower by tower, where
on that line to sit. A **Sink** lets you hold a gun on a hot tile without
tripping; a **Forge** (or an upgrade) pushes a gun further up and can tip a busy
one over. The **Lance** is the exception — it runs too cool to trip unaided, and
instead wants a Forge to reach its damage. The Forge and Sink let you cheat the
maze's heat locally.

## Thermal Modulation - Forge and Sink

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

- **The Forge** *adds* heat to each adjacent emitter as a fixed source, every
  second it stands — its `forgeHeat`, multiplied by the coupling percentage
  above, is poured into every orthogonal neighboring emitter's `H` (which
  **raises that emitter's ceiling**). This is the double-edged structure: in a
  lull, a Forge keeps a neighbor warm and strong when it would otherwise cool to
  feeble; in a heavy push, that same constant heat stacks on top of the
  neighbor's own firing heat and can inadvertently push it over the redline,
  tripping it.
- **The Sink** *strengthens the cooling* of each adjacent emitter — its
  `ventCool`, multiplied by the coupling percentage above, is **added to that
  emitter's `coolRate`**, so the emitter now cools by `(coolRate + ventCool) *
  (H / 100)` per second. Because it is proportional to heat, a Sink draws
  hardest when the tower is near the redline and gently when it is cool — it
  **lowers the ceiling** rather than chilling the tower to dead-cold. A Sink lets
  an emitter be run near **flat out** without tipping over: park one that would
  otherwise trip — a base gun on a saturated tile, one upgraded to run hot, or one
  fed by a Forge — beside a Sink and its ceiling drops back below `100`, so it
  settles hot and stays online. Sinks **stack** (their `ventCool`
  adds), and a single Sink is a lever, not immunity — a hot enough emitter (for
  instance one upgraded to run hotter, or fed by a Forge) can still climb past
  the redline through one Sink and needs a second, or an upgraded Sink, to hold.

The exact `forgeHeat` and `ventCool` values, and how upgrading these structures
changes them, are in `specs/towers.md`. Coupling is **local** — only orthogonal
neighboring footprints with shared edge contact are affected — so where you
place a Forge or a Sink on the floor is as much a part of the puzzle as where
you place the guns. Heat does not otherwise spread between emitters: an ordinary
emitter does not heat or cool its neighbors, only the Forge and Sink do.

## Tower Heat Relationships

Every tower relates to heat in one of three ways. Reading the floor helps
understand what each tower wants:

- **Heat-hungry** — most emitters (the Arc, Stutter, Lance, Bloom, and Flak of
  `specs/towers.md`). They follow the rule above: hotter means more damage, up to
  the redline, where they trip. A gun on a saturated tile climbs there on its own
  (the **Lance** is the exception — it runs too cool to trip unaided). They *want*
  heat, but fear that cliff — so they want a steady stream of targets without
  quite drowning in them, and a Sink nearby if they
  run too hot or a Forge nearby if they run too cold.
- **Heat-averse** — the cryo Rime. It runs the rule **backward**: heat does not
  power it, heat **degrades** it. The Rime slows the surge best when it is
  cold, and its slow weakens as it heats (see `specs/towers.md` for the exact
  curve). It still trips at the redline like any emitter, but you almost never
  want it near one: keep a Rime isolated or beside a Sink, away from Forges and
  hot cores, so it stays cold and slows hard.
- **Heat-movers** — the Forge (a source) and the Sink (a drain). They have no
  heat of their own and never fire; they exist only to push heat into or pull
  heat out of their neighbors, so you can reconcile the hungry and the averse
  on the same floor.

The maze sets each tower's baseline heat — packed lanes run hot, open lanes run
cold — and the movers let you override that baseline tile by tile. A good floor
is a deliberate thermal landscape: a white-hot core held just under the redline
by Sinks, a Forge keeping a slow gun fed, and a cold cryo pocket off on its own
— with the surge threaded through all of it.
