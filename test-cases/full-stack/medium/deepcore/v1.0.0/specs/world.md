# World — the mine, its bands, its tiles, and the surface

This file defines the tiled world the game plays in: the grid and coordinate system,
the camera, the four **depth bands** and the Core chamber, every **tile kind**, how
ore, materials, and hazards are placed, and the **surface** and its four buildings.
It is referenced by `specs/character.md` (movement and drilling), `specs/mining.md`
(ore and materials), `specs/hazards.md` (gas, lava, the core), `specs/upgrades.md`
and `specs/rocket.md` (the surface buildings), and `specs/flow.md` (the loop). The
numeric values here are **fixed**; implement them exactly.

## The tile grid

The world is a grid of square **tiles**, each **48 x 48 logical pixels**.

- The mine is **24 columns** wide, `col` in `[0, 23]`. Columns `0` and `23` are the
  unminable **bedrock border** (below). Playable columns are `1..22`.
- The grid is **24 columns x 48 = 1152 px** wide, drawn **centered** in the 1280-wide
  viewport with a 64 px letterbox of dark rock on each side. The world **never
  scrolls horizontally** — its full width is always on screen.
- Rows are numbered from the surface down: `row 0` is the **surface** (open ground /
  sky, where the buildings sit and the miner spawns), and the mine extends down to
  `row 96`, the **Core chamber**. Playable minable rows are `1..95`; `row 96` is the
  Core chamber (below).
- **Depth** is reported to the player in **meters**: each row below the surface is
  **5 m**, so `row r` is at depth `5 x r` m and the Core chamber is at **480 m**.
- The camera follows the miner **vertically only**. At rest on the surface it frames
  the camp, and the Core chamber floor never scrolls below the bottom of the viewport.
  There is **open sky above the surface with no ceiling** (`specs/character.md`): when
  the miner thrusts up out of the mine, the camera **follows it up** into that sky —
  there is nothing up there to reach, so the climb only burns fuel, but the miner is
  shown ascending rather than clipped at the top of the view. A tile at `(col, row)`
  occupies world-space
  `x in [64 + 48*col, 64 + 48*col + 48]`, `y = 48*row` in world coordinates, drawn at
  `y - cameraY` on screen (offset by the `56 px` status bar).

## The four depth bands + the Core chamber

The mine is banded by depth. Each band looks distinct (its own rock fill from the
palette, `specs/overview.md`), holds its own ore mix (`specs/mining.md`), escalates
in **hardness** (slower to drill, `specs/character.md`) and **hazard density**
(`specs/hazards.md`), and — for two of them — is the **only** place one of the
exotic materials is found (`specs/mining.md`, `specs/rocket.md`).

| Band | Rows | Rock fill | Tile hardness | Hazards | Exotic material |
| --- | --- | --- | --- | --- | --- |
| **Surface** | `0` | camp / sky | — (open) | — | — |
| **Topsoil** | `1–24` | `#3a2c1f` | `1` (soft) | none | — |
| **Rockbed** | `25–48` | `#3a3d44` | `2` | gas | **Resonite** (mid) |
| **Deepstone** | `49–72` | `#20242c` | `3` | gas, lava | **Cryenite** (deep) |
| **Coreshell** | `73–95` | `#3a1512` | `4` (very hard) | gas, dense lava | — |
| **Core chamber** | `96` | glowing pit | bedrock walls | the Core Sample | **Core Sample** |

The transition between bands is a visible change in the rock fill (and, in the
coreshell, a rising orange glow), so the player reads their depth from the world, not
only the meter. Band hardness sets how long a tile takes to drill and which drill
tiers can break it at all (`specs/character.md`, `specs/upgrades.md`): the topsoil
yields to the starting drill, but the deepstone and coreshell need upgraded drills to
dig at a workable speed — one of the ways the economy paces the descent.

## Tile kinds

Every grid cell is one of these kinds. A cell's kind is fixed at world generation
except that any **minable** cell becomes an **empty tunnel** once drilled.

- **Bedrock border** — columns `0` and `23`, the mine floor beneath `row 95`, and the
  walls of the Core chamber. **Unminable and impassable**: no drill breaks it and the
  miner cannot enter it. It bounds the playable space.
- **Earth / Rock / Deepstone / Coreshell** — the plain **minable** rock of each band.
  Drilling one (`specs/character.md`) removes it, leaving an **empty tunnel**, and
  yields nothing. Its drill time is set by the band's hardness and the miner's drill
  tier.
- **Ore vein** — a minable tile of the band's rock with an **ore deposit** in it
  (`specs/mining.md`). Drilling it removes the tile *and* adds that ore to cargo (if
  cargo has room). Ore veins are scattered through every band; the ore type and its
  odds are per band (`specs/mining.md`).
- **Material node** — a minable tile holding one of the two **buried exotic
  materials**, **Resonite** (rockbed) or **Cryenite** (deepstone) (`specs/mining.md`,
  `specs/rocket.md`). Drilling it collects the material. Placement is **guaranteed
  but hidden** (below); the **scanner** points the player to the nearest one.
- **Gas pocket** — a hazard tile (`specs/hazards.md`): drilling into it (or a drilled
  tile exposing it) triggers a gas explosion. It reads as a distinct, faintly glowing
  green tile.
- **Lava** — a hazard tile (`specs/hazards.md`): **not minable**, and touching it
  drains hull fast. The miner must route around it. It reads as molten orange and may
  animate (`specs/assets.md`).
- **Empty tunnel** — a cell that is open space: either an original gap (the surface,
  a natural cavern) or a minable tile that has been drilled out. The miner falls
  through it under gravity and thrusts through it on the jetpack.

## Placing ore, materials, and hazards

The mine is **generated per game** within these rules; there is no single fixed map,
but every rule below is fixed. Generation must obey them so a run is always winnable:

- **Playable region.** Columns `1..22`, rows `1..95` are minable rock of the row's
  band, except the cells made into ore veins, material nodes, hazards, and the natural
  tunnels/caverns generation may carve. A **clear vertical shaft** need not be
  provided — the player drills their own way down.
- **Ore.** Ore veins are scattered through all four bands at that band's ore mix and
  density (`specs/mining.md`). Ore is the routine reward for digging; a player who
  digs steadily always finds ore to sell.
- **Exotic materials — guaranteed but hidden.** **At least three** Resonite nodes
  exist somewhere in the **rockbed** band and **at least three** Cryenite nodes exist
  somewhere in the **deepstone** band, at **random positions within that band** —
  never at a fixed tile, but **always present** (a run can never lack a material it
  needs). The player finds them with the **scanner** (`specs/mining.md`), which points
  to the nearest uncollected material — the Terraria model: randomly placed, reliably
  locatable. Only **one** of each material is needed to win (`specs/rocket.md`); the
  surplus is a margin so a missed dig is not fatal.
- **The Core Sample** is not scattered: it sits in the **Core chamber** at `row 96`,
  reachable only by drilling down to the bottom (`specs/hazards.md`, `specs/rocket.md`).
- **Hazards.** Gas pockets appear from the rockbed down and lava from the deepstone
  down, denser with depth (`specs/hazards.md`), scattered so the deep dig is a real
  gauntlet — but generation must never seal the only route to a material or to the
  Core with an unbroken wall of lava; a determined driller can always get through.

## The surface

`Row 0` is the **surface camp**: a strip of scrapped ground under a dim dusk sky
(`specs/overview.md` palette), where the miner **spawns** and returns to between
digs, and where the four **buildings** stand. A shallow **cave mouth** in the camp
floor is the way down into `row 1`. The surface is open space the miner walks and
hovers across; there is no digging up here.

Four buildings sit on the surface, each a produced sprite (`specs/assets.md`) the
miner activates by standing at it and which opens an **overlay panel**
(`specs/controls.md`, `specs/flow.md`):

- **Fuel Depot** — where you **buy** fuel and hull repair. Nothing refills on its own;
  at the depot you spend **Credits** to add **fuel** (per unit) and to **repair hull**
  (per point), up to your current maxima (`specs/flow.md`, `specs/character.md`). The
  panel lets you buy a fixed increment or **fill / repair to full** (paying only for
  what is missing, and only as far as you can afford). The depot is a **shop**, not a
  free top-up — refuel and repair compete for Credits with upgrades and rocket parts.
- **Ore Market** — **sells** the ore in your cargo for Credits at the listed values
  (`specs/mining.md`, `specs/flow.md`), emptying the cargo.
- **Upgrade Shop** — buys the next tier on any of the seven **upgrade tracks** — fuel
  tank, drill, cargo bay, hull, jetpack, radiator, scanner — for Credits
  (`specs/upgrades.md`).
- **Launch Pad** — the **escape rocket** under construction: the component checklist,
  **fabricating** the next component (Credits, plus its exotic material if it needs
  one), and, once all five are installed, **LAUNCH** (`specs/rocket.md`). The rocket
  on the pad visibly gains each installed component (`specs/assets.md`).

Because fuel and repair are **bought**, a dig has **two** costs: the **round trip**
("can I get back before I run dry or am destroyed?") *and* the **Credits** the fuel and
repairs will cost once I do. The fuel tank, hull, radiator, and **jetpack** tiers
(`specs/upgrades.md`) set how deep — and how heavy a haul — a round trip can reach and
survive; Credits are spent on **fuel, repairs, upgrades, and the rocket** — the depot is
the third demand on every payday, so a reckless dig that burns a full tank and takes
heavy damage can cost more to recover from than it earned.
