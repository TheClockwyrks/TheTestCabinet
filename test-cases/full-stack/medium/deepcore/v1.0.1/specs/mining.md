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
vein removes the tile and adds **one unit** of that ore to cargo (if the bay has a free
**slot**). If the bay is **full by slot count**, the tile is still **cleared to tunnel**
(the drill never jams — you keep digging) but the ore is **left behind** and a "cargo
full" note shows. Each ore type has a fixed **value** (Credits when sold,
`specs/flow.md`) and a fixed **weight** in kilograms — the load the jetpack must lift on
the climb home (`specs/character.md`).

| Ore | Found in bands | Value (Credits/unit) | Weight (kg) | Value per kg | Reads as |
| --- | --- | --- | --- | --- | --- |
| **Ferron** | Topsoil, Rockbed | `28` | `10` | 2.8 | dull rust-brown flecks |
| **Cuprite** | Topsoil, Rockbed | `65` | `12` | 5.4 | teal-green nodules |
| **Argenite** | Rockbed, Deepstone | `150` | `16` | 9.4 | bright silver seams |
| **Voltite** | Deepstone, Coreshell | `380` | `24` | 15.8 | electric-blue crystals |
| **Pyronium** | Coreshell | `820` | `34` | 24.1 | glowing orange ore |
| **Adamite** | Deepstone, Coreshell (rare) | `1900` | `46` | 41.3 | rare aquamarine gem |

The "reads as" column is each ore's visual identity; each is drawn as a **smear of that
mineral run through the dirt** — embedded in the rock and spreading to the tile edges, not
a discrete dot on top of it (the Motherload look — `specs/world.md`, `specs/assets.md`).

Ore is collected only by **drilling** it. **Explosives destroy ore without collecting it**:
an ore tile caught in a Dynamite / Plastic Explosives blast (`specs/items.md`) is cleared
to tunnel like any other tile and its ore is **lost, not added to cargo** — the explosives
clear the way, they do not mine.

Value climbs **steeply** with depth while weight rises only gently, so **value-per-kg
climbs with depth**: a full bay of topsoil Ferron is pocket change — and barely worth
its weight on the climb — next to a single deep Adamite. This is the engine of the
descent: shallow ore keeps you afloat, but the money is deep. Each band's ore **mix**
(which of the above appear and how often) follows the table — shallow bands are mostly
cheap ore, deep bands mostly rich ore, with Adamite a rare glint anywhere deep. Ore
density is generous enough that steady digging always funds the next upgrade, and even
the **cheapest** ore is worth enough to clear the fuel a dig burns (Ferron `28` ≈ 28
units of fuel at the Fuel Depot, `specs/flow.md`) so a dig always nets a real surplus,
never a fuel-for-fuel treadmill (`specs/world.md`, `specs/flow.md`).

## Cargo — slots to carry, weight to fly out

Ore is held in the **cargo bay**, whose capacity is a **number of ore slots** set by the
**cargo tier** (`specs/upgrades.md`); the starting bay holds **`15` slots**. **One unit of
any ore fills one slot**, regardless of its weight — the Motherload cargo model. The HUD
shows the current cargo as **slots used / capacity**, alongside the current **load in kg**
(`specs/flow.md`).

**Weight is a separate mechanic.** Each ore's **weight** (the table above) is the load the
**jetpack** must lift on the climb home (`specs/character.md`) — it does **not** limit how
many pieces the bay holds. The two limits pull against each other exactly as in Motherload:

- **Slots limit how much you can pick up.** When the bay is **full by slot count**, an ore
  vein you drill is still **cleared** (the drill never jams) but the ore is **left behind**,
  and the game signals "cargo full". A bigger bay means more ore per surface trip.
- **Weight limits whether you can fly out.** A full bay of **light shallow** ore lifts
  easily; a bay part-filled with **heavy deep** ore can already exceed the jetpack's lift,
  so it climbs slowly and, past a point, **cannot lift at all** (`specs/character.md`). When
  that happens the miner **drops ore from the inventory** (`specs/character.md`) to shed
  weight until it can lift off — the escape valve for a haul that is rich but too heavy.
- Cargo is **emptied by selling** at the Ore Market (below). It is **not** emptied by
  refueling or repairing.
- **On death** (`specs/modes.md`): the run ends at a summary screen — there is **no dropped
  cache**. In **Standard** the player may **restore from their last save** and pick the
  expedition back up; in **Hardcore** the run is over.
- **Exotic materials do not use cargo** (below) — they ride in a separate satchel, carry
  **no weight**, take **no slot**, and never fill the bay.

## The inventory (cargo hold)

The player can open an **inventory** overlay at **any time** — on the surface or mid-dig
(`specs/controls.md`, `specs/flow.md`) — to see **exactly what they are carrying** and to
**ditch specific ore**. It lists **every ore held** with its **count and weight**, the
current **slots used / capacity** and **total load in kg**, an **OVERLOAD** warning when
the load is too heavy for the jetpack (`specs/character.md`), and the materials satchel.

- **Drop.** Each ore row has a **drop** control that discards **one unit** of that ore. The
  dropped ore is **lost** (not sold). This is the deliberate control for shedding weight
  when overloaded: the player chooses **which** ore to keep and which to ditch, rather than
  the game deciding for them.
- Opening the inventory **freezes the world** behind it (like any panel), but the Core
  Sample timer keeps running (`specs/hazards.md`) — the inventory is not a way to pause the
  core run.
- Materials in the satchel are shown for reference but are **not** droppable (they are
  weightless and needed for the rocket).

## Exotic materials

Three **exotic materials** exist, one per source, and each is needed for one rocket
component (`specs/rocket.md`). They are **not ore**: they are **not sold**, carry **no
weight and take no room in the cargo bay**, and are held in a small **materials satchel**
shown in the HUD. You
carry at most what you have found; collecting one you already hold simply banks a
spare.

| Material | Source | How obtained |
| --- | --- | --- |
| **Resonite** | **Rockbed** band material node (`specs/world.md`) | drill the node |
| **Cryenite** | **Deepstone** band material node | drill the node |
| **Core Sample** | **Core chamber** at the bottom (`specs/hazards.md`) | extract it — **unstable** |

- **Resonite** and **Cryenite** are each buried in **exactly one material node** at a
  random position **within their band**, but **guaranteed to exist and to be reachable**
  there (`specs/world.md`): the scanner (below) points you to it. **Only one of each is
  needed to win** (`specs/rocket.md`), so there is no spare — with a single node per band,
  the scanner is what makes the material findable and the run winnable. Drilling the node
  collects the material and banks it in the satchel.
- The **Core Sample** is different: it is **extracted** from the Core chamber and is
  **unstable**, starting a **destabilization timer** the moment you take it — you must
  install it at the launch pad before it **detonates** (`specs/hazards.md`,
  `specs/rocket.md`). It, too, rides in the satchel (not cargo), but if you **die**
  while carrying it, it is **destroyed** — a failed core run always means going back
  down for a fresh one (`specs/modes.md`). It can also be **jettisoned** onto the ground
  as a ground item and **re-collected** by walking back over it (`specs/items.md`), the
  timer running throughout. Saving stays **blocked** while its timer runs, carried or
  jettisoned (`specs/flow.md`, `specs/items.md`).

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
