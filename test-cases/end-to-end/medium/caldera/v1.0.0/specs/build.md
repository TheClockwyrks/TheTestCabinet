# Caldera — The economy: funds, structures, and building

This file defines what you spend and what you build: your **funds** and the **Core
upgrade**, every buildable structure and where the terrain lets you place it, and
repair and demolish. How the fluids those structures produce and consume actually
flow is in `specs/fluids.md`; the towers' combat stats are in `specs/towers.md`;
the terrain rules the placement checks against are in `specs/world.md`. All costs
are in **funds (`$`)**; values are best-effort defaults and **tunable**.

## Funds — the one currency

Everything is built and repaired with **funds (`$`)**, a single currency the
**Core** produces over time:

- The run begins with **`$600`** in the treasury (tunable).
- The Core produces a **base income of `$10` per second** (tunable), credited
  continuously (not in lump sums). The current balance and the live income rate are
  shown on the HUD (`specs/flow.md`).
- Funds are spent to place structures and pipes, to repair damage, and to upgrade
  (below). You can never spend below `$0`; a build you cannot afford is not placeable
  (its palette entry shows as unaffordable).

There is **no** other income — no bounty for kills, no resource nodes. Income comes
only from the Core and its upgrade. (This is deliberate: what pulls you out across
the map is the terrain's geography of **vents and water**, not per-kill or per-node
income — `specs/world.md`.)

## The Core upgrade — the economic lever

The Core can be **upgraded** to raise its income. This is the game's central
strategic decision (`specs/waves.md`): each upgrade is a lump of funds spent now for
more funds later, so upgrading too early can leave you too thin for the next wave,
and too late can leave you unable to afford the defense the late waves demand.

- The Core has upgrade **levels `0…3`** (starts at `0`). Each level raises the base
  income:

  | Upgrade | Cost | Income after |
  | --- | --- | --- |
  | Level 0 → 1 | `$400` | `$16/s` |
  | Level 1 → 2 | `$900` | `$24/s` |
  | Level 2 → 3 | `$1600` | `$34/s` |

  (Costs and rates tunable; the shape — rising cost, rising income, a real
  opportunity cost against buying defense now — is the requirement.)
- Upgrading is instant on purchase and shown on the Core and the HUD. Upgrading does
  **not** heal the Core or change its health pool (`specs/world.md`).

## Buildable structures

You build by selecting a structure from the build palette (`specs/flow.md`) and
placing it on a cell (or, for pipes, dragging a run of cells). Every placement is
checked against the terrain rules below; an illegal placement is refused with a
reason (`specs/flow.md`). Building is allowed **at any time** — during a wave as
well as between waves (`specs/waves.md`). The structures:

| Structure | Cost | Placed on | Role |
| --- | --- | --- | --- |
| **Water pipe** | `$10` / cell | any land or river cell | Carries **water** between structures (`specs/fluids.md`). |
| **Steam pipe** | `$12` / cell | any land or river cell | Carries **steam** between structures (`specs/fluids.md`). |
| **River Tap** | `$80` | a **river** (shallow-water) cell | Draws **water** at **low flow** (`specs/fluids.md`). |
| **Pump** | `$150` | a land cell **adjacent to deep water** | Draws **water** at **high flow**, and provides lift (`specs/fluids.md`). |
| **Boiler** | `$200` | a **geothermal vent** cell | Consumes water, produces **steam** (`specs/fluids.md`). |
| **Repeater** | `$90` | buildable land | Tower — fast anti-swarm (`specs/towers.md`). |
| **Mortar** | `$140` | buildable land | Tower — arcing splash (`specs/towers.md`). |
| **Lance** | `$220` | buildable land | Tower — anti-armor line (`specs/towers.md`). |
| **Scald** | `$180` | buildable land | Tower — steam-jet slow/burn field (`specs/towers.md`). |

### Placement rules — the terrain decides

Placement is where the terrain becomes law. A structure may be placed only where
**all** of these hold (the build cursor shows valid/invalid live, and why —
`specs/flow.md`):

- **Not on a cliff-locked island.** A structure's cell must be reachable — for
  pipes, connectable across flat/terraced edges to the rest of the network (below);
  a **cliff** edge (`d ≥ 2`, `specs/world.md`) cannot be built across.
- **Water pipes and steam pipes** lay on any land or **river** cell (a pipe crossing
  a river is drawn **raised** over the channel) but **not** on **deep water** and
  **not** across a **cliff** edge. Pipes lay **cell by cell** and connect to
  orthogonally adjacent (edge-sharing) pipes and structures across flat/terraced
  edges only. You lay a run of pipe by **click-dragging** across a legal path of
  cells (`specs/flow.md`); the path snaps to terrace-legal edges and **stops at a
  cliff**.
- **River Tap** only on a **river** cell; **Pump** only on a land cell that shares
  an edge with a **deep-water** cell.
- **Boiler** only on a **geothermal vent** cell (one boiler per vent).
- **Towers** only on **buildable land** — a non-water, non-vent, non-Core cell — and
  not across a cliff from their supplying pipe. A tower's **elevation** matters to
  its performance (`specs/towers.md`), so where on the terrain you place it is a real
  choice.
- **One structure per cell.** A cell holds at most one structure (a pipe may share a
  cell with nothing else); no stacking.

A placed structure snaps to its cell center and sits **founded on the terrain
surface** at that cell's elevation — no floating, no burying.

## Tower upgrades

A placed **tower** can be **upgraded** in place to make it stronger (its stats and
the upgrade effect are in `specs/towers.md`). Select a tower and choose **upgrade**;
it has **two** upgrade levels above base (`1` and `2`). Each upgrade costs a fraction
of the tower's build cost and raises the tower's steam demand (`specs/towers.md`), so
an upgraded defense draws more steam and must be fed. Upgrading is the **second**
funds sink alongside the Core upgrade; only towers upgrade — pipes, pumps, taps, and
boilers do not.

## Repair and demolish

Slag damage structures and pipes (`specs/enemies.md`), and a severed line starves
everything downstream (`specs/fluids.md`), so keeping the network intact is part of
play:

- **Repair.** Select a damaged structure or pipe and **repair** it to full health for
  a fraction of its build cost (about **half** the remaining damage as a share of
  build cost; tunable). A destroyed structure is gone — it must be **rebuilt**, not
  repaired.
- **Demolish.** Select any structure or pipe you built and **demolish** it, removing
  it and refunding **50%** of its build cost (tunable). Demolishing frees the cell and
  lets you re-route.

## Health of what you build

Every built structure and pipe has a **health pool** and shows a health bar when
damaged (`specs/overview.md`). Health pools:

| Structure | HP |
| --- | --- |
| Water pipe / Steam pipe (per cell) | `40` |
| River Tap | `120` |
| Pump | `180` |
| Boiler | `220` |
| Repeater / Mortar / Lance / Scald | `160` / `180` / `200` / `180` |

At `0` HP a structure is **destroyed**: it is removed, stops producing or carrying
whatever it did (a destroyed pipe **breaks the line** — `specs/fluids.md`), and must
be rebuilt. The Core is not a buildable structure and has its own pool
(`specs/world.md`).
