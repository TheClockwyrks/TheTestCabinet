# Hollowdeep — The economy: resources, building, and food

This file defines the colony's material loop: mining and refining resources, placing
build orders that delvers construct, and growing food. It builds on the tile world
in `specs/world.md` (digging and tiles), the delvers in `specs/delvers.md` (who do
the work), and the power network in `specs/power.md` (which is built through this
loop). The player places orders (`specs/controls.md`); delvers carry them out.

## Resources

The colony tracks a small set of **stocks**, shown in the HUD (`specs/flow.md`):

- **Ore** — the raw resource. Mined from **ore tiles** (`specs/world.md`).
- **Material** — refined build stock, the currency of construction. Made from ore by
  **refining** (below). Everything the colony builds costs material.
- **Food** — grown at the **fungus farm** (below) and eaten by delvers
  (`specs/delvers.md`).

You may add more stocks (for example a machine feedstock; `specs/power.md`) if your
design needs them — keep the set small and show each stock the player must manage in
the HUD.

## Refining

Raw **ore** is not directly buildable; it must be **refined into material**:

- Refining happens over time and is a delver **job** (`specs/delvers.md`) — either at
  a built **refinery** tile the delver operates, or as a standing job that turns
  stocked ore into material (your choice; a built refinery reads more clearly and is
  preferred). Define the **ore→material** conversion (for example a few ore per unit
  of material) and show both stocks in the HUD.
- Refining is the reason ore seams matter: the colony cannot build its way to
  survival without mining and refining ore first. How much refined material the colony
  has on hand at the start is set by `specs/mode.md`.

## Build orders

The player **places build orders**; delvers **construct** them from material. A build
order is not instant — placing it marks a **ghost/blueprint** on the tile, a delver
hauls the material and builds it (playing its build animation), and only then does the
finished tile exist.

- **Placement.** With the **build tool** and a chosen building (`specs/controls.md`),
  the player marks a target tile with a ghost. Placement is only legal where that
  building makes sense (a floor across open space, a wall in open space or against
  rock, a ladder in open space, a wire on a valid tile, a machine on open space near
  a wire) — reject or refuse illegal placements clearly.
- **Cost.** Each order costs **material** from the colony stock. If the colony lacks
  the material, the ghost waits (or placement is refused — state which in the
  `README`); a build cannot complete without paying its material.
- **Construction.** A free delver with a reachable ghost hauls material to it and
  builds it over a short build time, then the tile becomes the finished building. An
  unreachable ghost waits until a path (a dug route, a ladder) reaches it.
- **Cancelling.** Cancelling a ghost (`specs/controls.md`) removes the order and
  refunds nothing yet spent (your choice on partial refunds; state it in the `README`).

**The buildings.** At least these are buildable; you may add more (state additions in
the `README`):

- **Wall** — a solid built tile that **blocks gas** and is not walkable
  (`specs/gas.md`, `specs/delvers.md`). Walls partition the colony so good air can be
  held in one room while another is worked.
- **Floor** — a walkable surface that lets delvers cross open space
  (`specs/delvers.md`); it does not block gas.
- **Ladder** — a climbable tile that lets delvers move vertically
  (`specs/delvers.md`); it does not block gas.
- **Wire** — carries power (`specs/power.md`); does not block gas.
- **Machines** — the coal/manual generator, the oxygen diffuser, and the pump
  (`specs/power.md`), and the refinery if you build refining as a machine.
- **Fungus farm** — the food source (below).

## Food: the fungus farm

The colony feeds itself by farming a subterranean **fungus**:

- A **fungus farm** is a built tile (placed and constructed like any building) on
  which fungus **grows over time**. A grown (ripe) plot is **harvested** by a delver
  (a harvest job, `specs/delvers.md`), adding **food** to the colony stock and
  resetting the plot to grow again.
- Delvers **eat** from the food stock to satisfy hunger (`specs/delvers.md`). A colony
  with no farm, or whose farm cannot keep up with its delvers, runs its food to zero
  and its delvers begin to **starve** — the second way a colony dies (`specs/flow.md`).
- Growth may depend on conditions you define (for example needing breathable air, or a
  little light or power) — keep any such requirement simple and state it in the
  `README`. The essential loop is: **build a farm, let it grow, harvest it, eat** —
  and it must be established before the colony's starting provisions (if any) run out.

## The loop, together

Hollowdeep's material loop is one chain: **dig ore → refine to material → build the
machines and farms → those keep the delvers breathing and fed → so they can dig
more.** Every link costs delver labor and time, and the air and food clocks are
running the whole while — which is the survival pressure `specs/flow.md` makes
explicit.
