# Deepcore — Ore, cargo, materials, and the scanner

This file defines what the miner digs up and what it is worth: the ore types, the
gemstones, the cargo bay, the inventory, the two buried exotic materials, the
scanner that locates them, and selling. Every figure below carries the name this
specification gives it.

## Ore

Drilling an ore cell removes it and banks one unit of that ore into the cargo bay
when a slot is free. When the bay is full by slot count the cell still clears to
tunnel and the ore is left behind, with a `cargo full` note shown.

Ten mineral ores exist. Each has a fixed value in Credits, a fixed weight in
kilograms, and a depth curve that decides how often it is the ore a vein holds.

| Ore       | Value  | Weight | `peak` | `spread` | `pick` |
| --------- | ------ | ------ | ------ | -------- | ------ |
| Ferron    | `28`   | `10`   | `0.01` | `0.34`   | `1`    |
| Marlite   | `46`   | `14`   | `0.08` | `0.34`   | `1`    |
| Cuprite   | `65`   | `18`   | `0.19` | `0.34`   | `1`    |
| Argenite  | `150`  | `24`   | `0.36` | `0.34`   | `1`    |
| Cobaltine | `240`  | `31`   | `0.49` | `0.34`   | `1`    |
| Voltite   | `380`  | `39`   | `0.61` | `0.34`   | `1`    |
| Halcite   | `560`  | `48`   | `0.72` | `0.34`   | `1`    |
| Pyronium  | `820`  | `58`   | `0.87` | `0.34`   | `1`    |
| Cindrite  | `1250` | `70`   | `0.94` | `0.34`   | `1`    |
| Adamite   | `1900` | `84`   | `0.97` | `0.45`   | `0.06` |

Which ore a vein holds is drawn at the cell's depth fraction `f`, with each ore
weighted by

`weightAt(f) = pick * max(0, 1 - abs(f - peak) / spread)`

and the draw taken over those weights in proportion. Because the curves overlap
and are staggered, four or five ores are available at any depth and the mix shifts
continuously as the miner descends.

Ore is collected only by drilling. An ore cell caught in an explosives blast
clears to tunnel like any other cell and its ore is lost.

## Gemstones

Three gemstones exist, one per band below the topsoil. A gemstone is drawn from
the same curve as the ores above, so it adds no density of its own, and it behaves
exactly like an ore once collected: it fills one cargo slot, carries its weight,
and sells at the Ore Market.

| Gemstone | Value  | Weight | `peak`  | `spread` | `pick` |
| -------- | ------ | ------ | ------- | -------- | ------ |
| Verdite  | `450`  | `48`   | `0.375` | `0.125`  | `0.03` |
| Roselite | `1140` | `78`   | `0.625` | `0.125`  | `0.03` |
| Aurite   | `2460` | `116`  | `0.875` | `0.125`  | `0.03` |

Each gemstone's narrow curve confines it to its own band and its low `pick` keeps
it under `1%` of that band's cells, so a gemstone is an occasional find rather
than a routine sight.

## Cargo

Ore is held in the cargo bay, whose capacity is a number of slots set by the cargo
tier. One unit of any ore or gemstone fills one slot whatever its weight. The
status bar reads the slots used over the capacity, with the current load in
kilograms alongside.

- Slots limit how much is picked up.
- Weight limits whether the haul can be flown out, through the jetpack's lift.
- The bay is emptied by selling. Refueling and repairing do not empty it.
- Exotic materials are not cargo: they take no slot, carry no weight, and ride in
  a separate satchel.

## The inventory

The inventory overlay is openable at any time, on the surface or mid-dig. It lists
every ore held with its count and weight, the slots used over the capacity, the
total load in kilograms, an `OVERLOAD` reading while the miner is overloaded, the
materials satchel, and the held field supplies.

- Each ore row carries a drop control that discards one unit of that ore. The
  dropped unit is lost.
- Materials are shown and are not droppable.
- The world holds still behind the overlay, but a live Core Sample's timer keeps
  running.

## Exotic materials

Three exotic materials exist, and each is consumed by one rocket component. They
are held in the satchel, are never sold, and carry no weight.

| Material    | Source                                              |
| ----------- | --------------------------------------------------- |
| Resonite    | The single material node in the rockbed band.       |
| Cryenite    | The single material node in the deepstone band.     |
| Core Sample | Drilled downward onto the Core in the Core chamber. |

Drilling a material node banks its material and removes the node. Collecting a
material already held banks a spare.

The Core Sample is different. Extracting one starts the destabilization timer
the hazards carry, and it is destroyed by a death or by that timer expiring.
The Core is inexhaustible: drilling it never removes it, so another Core Sample is
always available, and only one may be live at a time, whether carried or ticking on
the ground.

## The scanner

The scanner locates the two buried material nodes. The miner starts without one
and buys it, and its range is set by the scanner tier.

- While the miner lacks Resonite the scanner targets the Resonite node, and while
  it lacks Cryenite it targets the Cryenite node. With both missing it targets
  whichever is nearer.
- The scanner locks on only while its target is within the tier's range, measured
  in tiles as the straight-line distance between the miner's cell and the node's
  cell. While locked, the game shows a direction to the target and a distance that
  tightens as the miner closes in.
- While nothing is locked, and while the miner has no scanner, nothing is shown.
- The scanner never targets the Core.

## Selling

`SELL` at the Ore Market converts the whole cargo to Credits at the values above
and empties the bay. Selling is the only source of Credits. The panel shows the
cargo broken down by ore, with counts and the total, before the sale is confirmed.
