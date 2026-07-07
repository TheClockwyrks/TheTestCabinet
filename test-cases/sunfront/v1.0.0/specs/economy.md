# Sunfront — Economy and building

This file defines the resource economy and how spawner structures are built,
upgraded, and sold. It refers to the build grid in `specs/playfield.md`, the unit
cost/stat table in `specs/units.md`, and the wave clock in `specs/waves.md`.

## The resource: sol

The single currency is **sol** (the legion's stored sunlight). Both sides run the
same economy.

- Each side **starts a match with `200` sol**.
- **Passive income** accrues continuously at a fixed rate of **`10` sol/s**. It
  does **not** increase automatically at the start of waves. Accrue smoothly
  (fractional sol per frame is fine); display the current whole-sol balance and
  the current per-second rate in the HUD.
- **No unit kill bounty.** Destroying enemy units grants **no sol**; units are
  removed for battlefield control only, not for income.
- **Reliquary bounty.** Destroying the **enemy** Reliquary grants a lump
  **`+700` sol** (and triggers the enemy's Aegis — see `specs/waves.md`).

Income is shared across your whole economy — there is no per-structure upkeep and
no separate resource type.

## Spawner structures

A **spawner** is a structure placed on an empty cell of your build grid
(`specs/playfield.md`). There is one spawner type per buildable unit in
`specs/units.md`. A placed spawner **emits one unit of its type at the start of
every wave**, at your muster line, for the rest of the match. Your **army size
each wave equals the number of spawners you own**; your army's **quality** is how
far you have upgraded them.

### Building

- Placing a spawner costs its unit's **build cost** (the `Cost` column in
  `specs/units.md`), deducted immediately. You may only place it on an **empty**
  grid cell, and only if you can afford it.
- Building is real-time and unlimited except by sol and by the 24 cells of your
  grid — you may fill every cell, mixing types freely.
- A newly built spawner takes part in the **next** wave; it does not retroactively
  spawn for a wave already begun.

### Upgrading

A spawner has a **level**, `1 → 2 → 3` (it is built at level 1).

- Each level **above 1** adds **`+30%` HP and `+30%` attack damage** (of the
  unit's base stats, additively: level 2 = +30%, level 3 = +60%) to **every unit
  that spawner emits from then on**. Movement, range, and the counter multipliers
  from `specs/units.md` are unchanged.
- Upgrading one level costs **`75%` of the unit's build cost** (rounded), and is
  only allowed up to level 3.
- Draw a spawner's level as small pips (1–3) on the structure, and carry the level
  onto the units it emits (e.g. brighter accent or a rank marker) so a player can
  read a veteran army on the field.

### Selling

- Selling a spawner refunds **`50%` of the total sol invested in it** (build cost
  plus every upgrade paid), rounded, and clears its cell for reuse.

## The AI's economy

The AI opponent runs the **same** economy — the same starting sol, the same
fixed income rate, the same costs — with no resource cheating. It spends its sol on
its own hidden grid; the player never sees the AI's balance or placements (fog of
war, `specs/playfield.md`). The AI's behavior is defined in `specs/flow.md`.
