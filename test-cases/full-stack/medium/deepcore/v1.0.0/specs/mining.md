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

There are **ten mineral ores**, staggered by depth so several are always
available and the mix shifts as you descend (the Motherload lineup). Each has a
fixed **value** and **weight** and appears over a **depth-frequency curve** — a
"common depth" it peaks at and a shallowest depth (min) below which it never
appears — so which ores you find, and in what proportion, changes continuously
with depth ("Where each ore appears", below). Rows map to depth at 5 m each
(`specs/world.md`).

| Ore | Value (Credits/unit) | Weight (kg) | Value per kg | Peaks around (band) | Reads as |
| --- | --- | --- | --- | --- | --- |
| **Ferron** | `28` | `10` | 2.8 | ~20 m — Topsoil | dull rust-brown flecks |
| **Marlite** | `46` | `12` | 3.8 | ~200 m — Topsoil | muted tan-gold flecks |
| **Cuprite** | `65` | `12` | 5.4 | ~475 m — Topsoil | teal-green nodules |
| **Argenite** | `150` | `16` | 9.4 | ~900 m — Rockbed | bright silver seams |
| **Cobaltine** | `240` | `20` | 12.0 | ~1225 m — Rockbed/Deepstone | indigo-slate crystals |
| **Voltite** | `380` | `24` | 15.8 | ~1525 m — Deepstone | electric-blue crystals |
| **Halcite** | `560` | `28` | 20.0 | ~1800 m — Deepstone | chartreuse nodules |
| **Pyronium** | `820` | `34` | 24.1 | ~2175 m — Coreshell | glowing orange ore |
| **Cindrite** | `1250` | `40` | 31.3 | ~2350 m — Coreshell | glowing ember-red ore |
| **Adamite** | `1900` | `46` | 41.3 | ~2425 m — Coreshell (rare) | rare aquamarine glint |

The **four SIGNATURE ores** the upgrade ladder is priced against — **Cuprite**, **Argenite**,
**Voltite**, **Pyronium** — are unchanged (`specs/upgrades.md`).

The "reads as" column is each ore's visual identity; each is drawn as a **smear of that
mineral run through the dirt** — embedded in the rock and spreading to the tile edges, not
a discrete dot on top of it (the Motherload look — `specs/world.md`, `specs/assets.md`). The
ten smears must be **visually distinguishable** from one another so a player can tell a rich
vein from a cheap one at a glance.

Ore is collected only by **drilling** it. **Explosives destroy ore without collecting it**:
an ore tile caught in a Dynamite / Plastic Explosives blast (`specs/items.md`) is cleared
to tunnel like any other tile and its ore is **lost, not added to cargo** — the explosives
clear the way, they do not mine.

### Where each ore appears — constant density, depth-curve type

Ore is placed in **two independent stages** so the **share of tiles that are ore stays
roughly constant** at every depth while **which** ore they hold shifts smoothly with depth:

1. **Is a cell ore at all?** One **constant** roll — the same fraction of rock in
   every band, at every depth — so ore density never spikes in one stratum.
   (Density is generous enough that steady digging always funds the next
   upgrade.)
2. **If so, which ore?** A weighted roll over every ore's **frequency at that
   depth**, from its triangular **depth curve**: zero above its **min depth**,
   rising to a peak at its **common depth**, then tapering off deeper. Because
   the curves **overlap** and are staggered, **4–5 ores are available in any
   band**, and the distribution shifts **within** a band — the bottom of a
   stratum rolls a different mix than its top. A shallow staple (Ferron) is
   common from the surface and fades with depth; a deep ore (Cindrite, Adamite)
   never appears shallow. Adamite is a deliberately **rare glint** — a wide,
   deep curve with a very low peak.

This is what makes the descent read like Motherload: because the valuable ore is only a small,
depth-gated fraction of the ore you see, you **aim for specific rich veins** rather than
strip-mining a band where half the ore is the good kind.

The depth curves are keyed to the **fraction of the descent**, not to an absolute row, so
the ore mix holds at any **world size** (`specs/world.md`): a Quick or Marathon mine rolls
the same distribution at the same proportional depth as the Standard mine — a shorter or
longer dig through the identical progression of ores.

Value climbs **steeply** with depth while weight rises only gently, so **value-per-kg
climbs with depth**: a full bay of topsoil Ferron is pocket change — and barely worth its
weight on the climb — next to a single deep Adamite. This is the engine of the descent:
shallow ore keeps you afloat, but the money is deep. Even the **cheapest** ore is worth
enough to clear the fuel a dig burns (Ferron `28` ≈ 28 units of fuel at the Fuel Depot,
`specs/flow.md`) so a dig always nets a real surplus, never a fuel-for-fuel treadmill
(`specs/world.md`, `specs/flow.md`).

## Gemstones

Scattered among the ore, from the **rockbed down**, is a **gemstone** — a rarer, richer
find than a mineral ore. There is **one gemstone per band below the topsoil** (the topsoil,
the first band, holds only plain ore — **no gems**), and each is worth **3× the value** and
weighs **2× the weight** of that band's **signature ore** (`specs/upgrades.md` — the ore a
tier's price is anchored to: Rockbed Argenite, Deepstone Voltite, Coreshell Pyronium).
So a gem is a **rich but heavy prize** — a lift-and-haul decision, not free money.

| Gemstone | Band | Value (Credits/unit) | Weight (kg) | Value per kg | Reads as |
| --- | --- | --- | --- | --- | --- |
| **Verdite** | Rockbed | `450` (3 × Argenite `150`) | `32` (2 × `16`) | 14.1 | faceted emerald-green jewel |
| **Roselite** | Deepstone | `1140` (3 × Voltite `380`) | `48` (2 × `24`) | 23.8 | faceted rose-crimson jewel |
| **Aurite** | Coreshell | `2460` (3 × Pyronium `820`) | `68` (2 × `34`) | 36.2 | faceted golden jewel |

- **Gems are visually distinct from ore.** Each is drawn as a **cut, faceted jewel** — a
  brilliant-cut stone with a flat top table, angled facets, and a bright glint — sitting in
  the rock, **not** the diffuse mineral **smear** an ore vein reads as (and distinct again
  from the raw crystal cluster of a **material node**, above). A gemstone reads at a glance
  as the rarer, richer find (`specs/world.md`, `specs/assets.md`).
- **Otherwise a gem behaves exactly like ore.** Drilling one adds a unit to the **cargo
  bay** (one **slot**, like any ore), it carries its **weight** for the jetpack to lift
  (`specs/character.md`), it is **sold at the Ore Market** for its value, and explosives
  **destroy** it without collecting it — everything the ore rules above say applies. It is
  **not** an exotic material: it is sold, not needed for the rocket.
- **Gems are genuinely rare** — **well under 1 % of a band's tiles**, far rarer than ore,
  so you find one only every so often rather than several on a single screen. Like ore they
  grow richer and heavier the deeper the band. A gem's high value-per-kg makes it worth the
  haul, but its weight eats into what the jetpack can lift out in one trip, so a bay of deep
  gems is a real weight-management decision (`specs/character.md`).

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
| **Core Sample** | **Core chamber** at the bottom (`specs/hazards.md`) | drill the Core — **unstable**, and the Core is **inexhaustible** |

- **Resonite** and **Cryenite** are each buried in **exactly one material node** at a
  random position **within their band**, but **guaranteed to exist and to be reachable**
  there (`specs/world.md`): the scanner (below) points you to it. **Only one of each is
  needed to win** (`specs/rocket.md`), so there is no spare — with a single node per band,
  the scanner is what makes the material findable and the run winnable. Drilling the node
  collects the material and banks it in the satchel.
- The **Core Sample** is different: it is **drilled** from the Core at the bottom and is
  **unstable**, starting a **destabilization timer** the moment you take it — you must
  install it at the launch pad before it **detonates** (`specs/hazards.md`,
  `specs/rocket.md`). It rides in the satchel (not cargo). Unlike the material nodes, the
  **Core is inexhaustible**: drilling it never uses it up, so you can go back down and
  take **another Core Sample** whenever you don't currently hold a live one (one is "live"
  while carried or while ticking on the ground). So a **death** that destroys the carried
  Sample, or a **jettison** you can't recover, just means another trip to the Core — never
  a soft-lock (`specs/modes.md`). It can be **jettisoned** onto the ground as a ground
  item to flee its blast, but a jettisoned Sample is a **one-way discard — it cannot be
  re-collected** (`specs/items.md`); the timer keeps running on it wherever it lands.
  Saving stays **blocked** while its timer runs, carried or jettisoned (`specs/flow.md`,
  `specs/items.md`).

## The scanner

The **scanner** is the tool that makes the hidden materials findable — the game's
answer to "guaranteed but randomly placed". It is **always on** (you start with a
basic one) and drawn in the HUD / over the world as a **directional indicator**
(`specs/assets.md`, drawn in code):

- It points toward the **nearest uncollected material you still need** — the nearest
  Resonite while you lack Resonite, the nearest Cryenite while you lack Cryenite —
  within its **range**, showing **direction** (an arrow toward it) and a rough
  **distance** read that tightens as you close in. The indicator appears **only when the
  scanner has locked on** to a needed material within range; when nothing needed is in
  range there is **no indicator at all** (no idle "no signal" readout cluttering the view).
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
