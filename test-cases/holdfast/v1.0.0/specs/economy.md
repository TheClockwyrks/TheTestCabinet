# Holdfast — The economy: resources, building, farming, and food

This file defines the colony's material loop: gathering and stocking resources, placing
build orders that settlers construct, growing crops, and cooking them into the meals the
settlers eat. It builds on the tile world in `specs/world.md` (terrain and resource
nodes), the settlers in `specs/settlers.md` (who do the work), and feeds the defenses in
`specs/combat.md` (walls and turrets are built through this loop). The player places
orders (`specs/controls.md`); settlers carry them out.

## Resources

The colony tracks a small set of **stocks**, shown in the HUD (`specs/flow.md`):

- **Wood** — gathered by **chopping trees** (`specs/world.md`). The common build
  material.
- **Ore** — gathered by **mining ore veins** (`specs/world.md`). A sturdier material
  used for the structures that need it (for example turrets, heavier walls) — your
  design decides which buildings cost wood, which cost ore, and which cost both; keep
  it legible and state the costs in the `README`.
- **Crops** — raw food grown at **farm plots** (below). Not eaten directly.
- **Meals** — cooked food, made from crops at the **stove** (below) and eaten by
  settlers (`specs/settlers.md`).

You may add more stocks if your design needs them — keep the set small and show each
stock the player must manage in the HUD.

## Build orders

The player **places build orders**; settlers **construct** them from stocked material.
A build order is not instant — placing it marks a **ghost/blueprint** on the tile, a
settler hauls the material and builds it (playing its work animation), and only then
does the finished structure exist.

- **Placement.** With the **build tool** and a chosen structure (`specs/controls.md`),
  the player marks a target tile with a ghost. Placement is only legal where that
  structure makes sense (a wall or building on clear walkable ground, a floor on
  ground, a door in a wall line, a turret on clear ground with a field of fire) —
  reject or refuse illegal placements clearly.
- **Cost.** Each order costs **material** (wood and/or ore) from the colony stock. If
  the colony lacks the material, the ghost waits (or placement is refused — state which
  in the `README`); a build cannot complete without paying its material.
- **Construction.** A free settler with a reachable ghost hauls material to it and
  builds it over a short build time (faster for a skilled builder, `specs/settlers.md`),
  then the tile becomes the finished structure and **construction dust** puffs from it
  (`specs/assets.md`). An unreachable ghost waits until a path reaches it.
- **Cancelling.** Cancelling a ghost (`specs/controls.md`) removes the order and refunds
  nothing yet spent (your choice on partial refunds; state it in the `README`).

**The structures.** At least these are buildable; you may add more (state additions in
the `README`):

- **Wall** — a solid built tile that **blocks movement** and gives **cover** to a
  shooter behind it (`specs/combat.md`); it is how the colony walls itself in. A wall
  can be **deconstructed** or, in combat, **damaged and destroyed** (`specs/combat.md`).
- **Door** — a built tile in a wall line that settlers (but, by preference, not raiders
  freely) can **pass through** while it still closes the line for containment and cover
  (`specs/settlers.md`, `specs/combat.md`). Doors let the colony wall in without
  trapping its own workers.
- **Floor** — a built ground surface (a clean path/room floor). It does not block
  movement; it may speed movement and lift mood (your choice; state it in the `README`).
- **Bed** — where a settler **sleeps** to recover rest (`specs/settlers.md`). A colony
  with beds rests better (and in better mood) than one sleeping on the ground.
- **Stove** — where a settler **cooks** crops into meals (below).
- **Farm plot** — where **crops** grow (below).
- **Turret** — an automated **ranged defense** (`specs/combat.md`), built from material
  (typically including ore). It fires at raiders in range on its own.

## Farming and food

The colony feeds itself by farming and cooking:

- **Farm plot.** A built plot (placed and constructed like any structure, best on
  fertile ground, `specs/world.md`) on which a **crop grows over time**. A settler
  **sows** the plot (if your model requires sowing) and, when the crop is ripe,
  **harvests** it (a farm job, `specs/settlers.md`), adding **crops** to the stock and
  resetting the plot to grow again. Growth may depend on conditions you define (for
  example daylight, `specs/time.md`) — keep any such requirement simple and state it in
  the `README`.
- **Stove and cooking.** Raw **crops** are not eaten directly; a settler **cooks** them
  into **meals** at a built **stove** (a cook job), consuming crops and producing meals
  (define the crops→meals conversion and show both stocks in the HUD). A better cook
  produces meals more efficiently (`specs/settlers.md`).
- **Eating.** Hungry settlers **eat meals** from the stock to satisfy hunger
  (`specs/settlers.md`). A colony with no farm, or whose farm-and-stove chain cannot keep
  up with its settlers, runs its meals to zero and its settlers begin to **starve** — one
  of the ways a colony dies (`specs/flow.md`).

The essential food loop is: **build a farm and a stove, grow crops, harvest them, cook
meals, eat** — and it must be established before the colony's starting provisions (if
any) run out.

## The loop, together

Holdfast's material loop is one chain: **chop and mine → stock wood and ore → build the
walls, beds, stove, farm, and turrets → grow, cook, and eat food, and defend the
base → so the colony survives to gather more.** Every link costs settler labor and time,
and the food clock and the raid clock (`specs/combat.md`) are running the whole while —
which is the survival pressure `specs/flow.md` makes explicit.
