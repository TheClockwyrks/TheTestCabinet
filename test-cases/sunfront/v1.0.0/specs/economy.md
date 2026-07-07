# Sunfront — Economy and building

This file defines the resource economy and how build-grid structures are placed,
upgraded, and sold. It refers to the build grid in `specs/playfield.md`, the unit
cost/stat table in `specs/units.md`, and the wave clock in `specs/waves.md`.

## The resource: sol

The single currency is **sol** (the legion's stored sunlight). Both sides run the
same economy.

- Each side **starts a match with `200` sol**.
- **Passive income** accrues continuously at a fixed rate of **`10` sol/s**. It
  does **not** increase automatically at the start of waves. Accrue smoothly
  (fractional sol per frame is fine); display the current whole-sol balance and
  the current total per-second rate in the HUD.
- **No unit kill bounty.** Destroying enemy units grants **no sol**; units are
  removed for battlefield control only, not for income.
- **Reliquary bounty.** Destroying the **enemy** Reliquary grants a lump
  **`+700` sol** (and triggers the enemy's Aegis — see `specs/waves.md`).

Income is shared across your whole economy — there is no upkeep and no separate
resource type.

## Build-grid structures

Build-grid structures are the player-built economy objects in the staging-yard build
grid (`specs/playfield.md`). There are two kinds: **spawners**, which emit combat
units on waves, and **Solar Extractors**, which increase passive income. Both occupy
one grid cell and share the same select, upgrade, and sell flow.

### Building

- Build-grid structures are placed on empty cells of your staging-yard build grid.
  You may only place a structure on an **empty** grid cell, and only if you can
  afford it.
- Placement is immediate: cost is deducted at once, the structure appears at once,
  and there is no build timer.
- Building is real-time and unlimited except by sol and by the 24 cells of your
  grid — you may fill every cell, mixing spawners and Solar Extractors freely.
- Build costs and placement effects are defined by each structure type below.

### Upgrading

All build-grid structures have a **level**, `1 -> 2 -> 3` (built at level 1).

- Upgrade costs and effects are defined by each structure type below. Upgrading is
  only allowed up to level 3.
- Draw a structure's level as small pips (1-3) on the structure.

### Selling

- Selling a build-grid structure refunds **`50%` of the total sol invested in it**
  (build cost plus every upgrade paid), rounded, and clears its cell for reuse.

## Spawner structures

A **spawner** is a build-grid structure tied to a unit type. There is one spawner
type per buildable combat unit in `specs/units.md`. A placed spawner **emits one
unit of its type at the start of every wave**, at your muster line, for the rest of
the match. Your **army size each wave equals the number of spawners you own**; your
army's **quality** is how far you have upgraded them.

- **Build cost:** the unit's **build cost** (the `Cost` column in
  `specs/units.md`), deducted immediately.
- **Placement effect:** a newly built spawner takes part in the **next** wave; it
  does not retroactively spawn for a wave already begun.
- **Upgrade cost:** `75%` of the unit's build cost, rounded, per level.
- **Upgrade effect:** each level **above 1** adds **`+30%` HP and `+30%` attack
  damage** (of the unit's base stats, additively: level 2 = +30%, level 3 = +60%)
  to **every unit that spawner emits from then on**. Movement, range, and the
  counter multipliers from `specs/units.md` are unchanged.
- **Unit level display:** carry the spawner level onto the units it emits (e.g.
  brighter accent or a rank marker) so a player can read a veteran army on the field.

## Solar Extractors

A **Solar Extractor** is an economic build-grid structure. It does **not** emit a
unit, does not affect wave size, and has no combat role. Its job is to increase the
owner's passive income; placing one means spending a grid cell and sol on economy
instead of on another wave spawner.

- **Build cost:** `180` sol.
- **Placement effect:** starts adding its income bonus immediately.
- **Upgrade cost:** `135` sol per level.
- **Income by level:** `+4` sol/s at level 1, `+7` sol/s total at level 2, and
  `+10` sol/s total at level 3.

There is no hard cap on Solar Extractors beyond grid space. A player can build many
for a stronger long-term economy, but every Extractor consumes a cell that could
have been a spawner and therefore weakens near-term wave size.

## The AI's economy

The AI opponent runs the **same** economy — the same starting sol, the same
fixed base income rate, the same Solar Extractor rules, the same costs — with no
resource cheating. It spends its sol on its own hidden grid; the player never sees
the AI's balance or placements (fog of war, `specs/playfield.md`). The AI's
behavior is defined in `specs/flow.md`.
