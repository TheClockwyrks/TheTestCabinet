# Mining — ore, cargo, exotic materials, and the scanner

This file defines what you dig up and what it is worth: the **ore** types and their
values per band, the **cargo** you carry them in, the three **exotic materials** the
rocket needs and the **scanner** that finds them, and **selling**. It refers to the
world's bands and tiles (`specs/world.md`), the miner (`specs/character.md`), the
upgrade tiers (`specs/upgrades.md`), the rocket (`specs/rocket.md`), and the economy
(`specs/flow.md`). The numeric values here are **fixed**; implement them exactly,
except **cargo capacity** and **scanner range**, which `specs/upgrades.md` sets per
tier.

## Ore

**Ore veins** (`specs/world.md`) are the routine reward for digging. Drilling an ore
vein removes the tile and adds **one unit** of that ore to cargo (if cargo has room;
if it is full, the ore is left in the ground — the tile stays an ore vein — and a
"cargo full" note shows). Each ore type has a fixed **value** (Credits when sold,
`specs/flow.md`) and each unit takes **one** cargo slot.

| Ore | Found in bands | Value (Credits/unit) | Reads as |
| --- | --- | --- | --- |
| **Ferron** | Topsoil, Rockbed | `6` | dull rust-brown flecks |
| **Cuprite** | Topsoil, Rockbed | `14` | teal-green nodules |
| **Argenite** | Rockbed, Deepstone | `30` | bright silver seams |
| **Voltite** | Deepstone, Coreshell | `65` | electric-blue crystals |
| **Pyronium** | Coreshell | `140` | glowing orange ore |
| **Adamite** | Deepstone, Coreshell (rare) | `300` | rare aquamarine gem |

Value climbs steeply with depth, so the descent pays for itself: a full cargo of
topsoil Ferron is pocket change next to a single deep Adamite. Each band's ore **mix**
(which of the above appear and how often) follows the table — shallow bands are mostly
cheap ore, deep bands mostly rich ore, with Adamite a rare glint anywhere deep. Ore
density is generous enough that steady digging always funds the next upgrade
(`specs/world.md`, `specs/flow.md`).

## Cargo

Ore is held in the **cargo bay**, which has a fixed **capacity** in units set by the
**cargo tier** (`specs/upgrades.md`); the starting bay holds `15` units. The HUD shows
cargo as **used / capacity** (`specs/flow.md`).

- When the bay is **full**, further ore cannot be picked up — the vein is left in the
  ground for a later trip, and the game signals "cargo full". This is a real decision:
  a bigger bay means fewer surface trips, but you still need the fuel to climb back
  with a heavy haul.
- Cargo is **emptied by selling** at the Ore Market (below). It is **not** emptied by
  refueling or repairing.
- **On death** (`specs/modes.md`): in **Standard**, the cargo you are carrying is
  **dropped as a retrievable cache** at the death site; in **Hardcore** the run ends.
- **Exotic materials do not use cargo** (below) — they ride in a separate satchel and
  never take a cargo slot.

## Exotic materials

Three **exotic materials** exist, one per source, and each is needed for one rocket
component (`specs/rocket.md`). They are **not ore**: they are **not sold**, take **no
cargo slot**, and are held in a small **materials satchel** shown in the HUD. You
carry at most what you have found; collecting one you already hold simply banks a
spare.

| Material | Source | How obtained |
| --- | --- | --- |
| **Resonite** | **Rockbed** band material node (`specs/world.md`) | drill the node |
| **Cryenite** | **Deepstone** band material node | drill the node |
| **Core Sample** | **Core chamber** at the bottom (`specs/hazards.md`) | extract it — **unstable** |

- **Resonite** and **Cryenite** are buried in **material nodes** scattered at random
  positions **within their band**, but **guaranteed to exist** there (`specs/world.md`):
  the scanner (below) points you to the nearest one. Drilling the node collects the
  material and banks it in the satchel.
- The **Core Sample** is different: it is **extracted** from the Core chamber and is
  **unstable**, starting a **destabilization timer** the moment you take it — you must
  install it at the launch pad before it **detonates** (`specs/hazards.md`,
  `specs/rocket.md`). It, too, rides in the satchel (not cargo), but if you **die**
  while carrying it, it is **destroyed** — dropped caches never contain the Core
  Sample (`specs/modes.md`).

## The scanner

The **scanner** is the tool that makes the hidden materials findable — the game's
answer to "guaranteed but randomly placed". It is **always on** (you start with a
basic one) and drawn in the HUD / over the world as a **directional indicator**
(`specs/assets.md`, drawn in code):

- It points toward the **nearest uncollected material you still need** — the nearest
  Resonite while you lack Resonite, the nearest Cryenite while you lack Cryenite —
  within its **range**, showing **direction** (an arrow toward it) and a rough
  **distance** read that tightens as you close in. If none of the needed materials is
  within range, the scanner reads "no signal".
- Its **range** is set by the **scanner tier** (`specs/upgrades.md`): the basic
  scanner has a short range, so early on you must be reasonably close before it locks
  on; upgrading widens the range (and tightens the distance read) so you can home in
  from farther away. The scanner is a genuine upgrade target, not just a freebie.
- The scanner **never points at the Core Sample** — the Core is not hidden, it is
  simply deep; you reach it by drilling to the bottom.

The scanner guarantees a run is always completable: the materials are always present
in their bands, and the scanner will always lead you to them (the Terraria model),
so a reviewer can never be soft-locked by an unlucky map (`specs/world.md`).

## Selling

At the **Ore Market** on the surface (`specs/world.md`), **SELL** converts the entire
cargo to **Credits** at the listed values above and empties the bay. Selling is the
only source of Credits (`specs/flow.md`); Credits are spent on **upgrades**
(`specs/upgrades.md`) and **rocket components** (`specs/rocket.md`). The market panel
shows the cargo breakdown (how many of each ore and its total) before you confirm the
sale.
