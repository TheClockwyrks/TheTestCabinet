# Caldera — The world: the hex caldera, terrain, water, and vents

This file defines the battlefield: the hex grid, the discrete elevation and the
**terraces and cliffs** that connect it, the procedurally generated caldera
terrain, the rivers and lakes, the geothermal vents, the two rim breaches the Slag
enter through, and the Core you defend. Coordinates, sizes, and elevation are in
**world units** and **levels** on the hex grid from `specs/overview.md`. What you
build on this world is in `specs/build.md`; the fluids that flow across it are in
`specs/fluids.md`; the Slag that assault it are in `specs/enemies.md`.

The **quality of the terrain you generate — how natural, varied, legible, and
watertight the caldera is, and how correctly the terraces, cliffs, rivers, and
water read** — is central to what this build is about. There is deliberately
little steering on the *shape*; there is exact steering on the *rules*.

## The hex grid

The map is a rectangular grid of hexagonal cells (`specs/overview.md`):

- **Grid size:** about **`40` columns × `32` rows** of cells (tunable; keep the
  proportions and the caldera layout below). The outer edge cells form the world
  boundary — nothing may leave the grid.
- Each cell has an integer **elevation level** in `0…8`, an inland **terrain
  material** (grass/dirt/rock/scorched/ash), and may carry **water** (a river or
  submerged deep water; below) or a **feature** (a vent, the Core, or a breach).
- A cell's center is its logical position; all placement, pathing, and targeting
  resolve on cell centers and the **true grid** (`specs/overview.md`).

## Elevation, terraces, and cliffs — the core of the terrain

This is the single hardest and most important part of the world to get right. Two
adjacent cells are joined across their shared edge by their elevation difference
`d = |e₁ − e₂|`:

- **`d = 0` — flat.** The two cells' surfaces meet coplanar across the edge.
- **`d = 1` — a terraced slope.** The one-level (`3`-unit) rise is **not** a smooth
  ramp: it is broken into a small fixed number of **terrace steps** — flat treads
  separated by short vertical risers — so a single-level slope reads as **stepped
  terraces**. Use **2 terrace treads** across the slope (tunable, but it must read
  as discrete steps, not a ramp). Terraces appear the same way on the triangular
  **corner** where three cells of differing but terrace-connected levels meet — the
  corner is a terraced junction, not a torn hole.
- **`d ≥ 2` — a cliff.** The cells are joined by a **vertical cliff face** (rock),
  with **no** terrace. A cliff is impassable: neither pipes nor Slag cross a cliff
  edge (`specs/fluids.md`, `specs/enemies.md`).

Getting this right means: **every** edge and **every** corner of the mesh is
closed — terraces on `d = 1` edges, cliff faces on `d ≥ 2` edges, coplanar joins
on `d = 0` — with **no holes, no gaps, and no cracks** where treads, risers,
cliffs, and corners meet, at any combination of the six neighbors' levels. This is
where a weak build fails: torn corners, missing cliff faces, terraces that float or
z-fight, or gaps a unit falls through. The terraces and cliffs must be visible and
correct from the tilted camera and in wireframe (`specs/overview.md`).

### Irregularity

To avoid a mechanical honeycomb, **perturb the render geometry** with procedural
noise: displace the mesh vertices (and terrace/cliff detail) by a small noise
offset so cell edges and terrace steps do not line up on a perfect lattice and the
terrain reads as organic. Two rules constrain this:

- The perturbation is **render-only**. Cell **centers** and all gameplay logic
  (placement legality, elevation levels, pathing, targeting) stay on the **true,
  unperturbed grid** — the wobble is in the drawn surface, not the rules.
- Perturbation must **not** open holes or push a vertex through a neighbor: the
  mesh stays watertight (below) after perturbation.

## Terrain surface — procedural, not flat colors

The terrain surface must **not** be flat single-color fills. Modulate each cell's
surface color with **procedural noise generated in code** (Perlin, simplex, value
noise, or equivalent) so grass, rock, and ash vary tile-to-tile and within a tile,
in the terrain palette from `specs/overview.md`. You are given **no** texture
files and must not fetch any — the variation is computed. The intended look:
**grass** greens on the low and mid slopes, **rock/basalt** on the high rim and
cliff faces, **scorched** earth ringing the vents, **ash/path** in worn low
ground, and dirt beneath. The result must read as a coherent natural caldera, not
random noise or a flat plane.

## The caldera — procedurally generated, non-destructible

Generate the terrain each match as a **breached volcanic caldera**:

- **A bowl.** A roughly bowl-shaped basin: a **high rim** of cells at elevation
  `6…8` (cliffs and steep terraces) enclosing most of the map, mid slopes at
  `3…5`, and a **low central floor** at `0…2`. Real, varied elevation change is
  required — meaningful high ground and low ground, ridges and hollows — not a flat
  plane and not random noise.
- **Traversable.** Despite the relief, there must be a **navigable route on foot
  across terraces** from each breach (below) inward to the Core — do not seal the
  interior behind an unbroken ring of cliffs. Cliffs are welcome and expected as
  walls and chokepoints; a cliff must never make the map **unsolvable** (below).
- **Watertight.** The landform is a closed mesh down to a base: **no holes** a unit
  falls through, **no floating cells** or cliffs hanging in the air, and no cracks
  at terrace/cliff corners (above).
- **Non-destructible.** Terrain does not change during a match. Nothing — towers,
  Slag, effects — carves, craters, raises, or lowers a cell. Elevation, terraces,
  cliffs, water, and vents are **fixed at generation** and pathing may treat the
  terrain as static (`specs/enemies.md`). The player does **not** reshape the
  terrain (`specs/flow.md`, out of scope).

## Water — rivers and deep water

Water is generated into the low terrain and is **both a resource and an obstacle**
(`specs/fluids.md`, `specs/enemies.md`):

- **Deep water** — a **lake** (and/or a coastal edge) pooled in the lowest basin,
  at least one body large enough to pump from. Deep-water cells are **impassable**
  to Slag (a hard wall shaping their approach) and are the **high-flow** pump sites
  (`specs/build.md`, `specs/fluids.md`). Draw it in the deep-water color with an
  **animated surface** (below).
- **Rivers** — **one or two** rivers, each a connected chain of shallow-water cells
  running **downhill from a high source to the lake/low outlet**. A river must flow
  **strictly non-uphill**: each successive river cell along the flow is at an equal
  or lower elevation than the previous — a river must **never** climb. Carve the
  river visibly into the terrain (a channel a step below its banks) and draw it in
  the shallow-water color, flowing toward its outlet. Rivers are **wade-slow**
  terrain for Slag (crossable but slowing; `specs/enemies.md`) and **low-flow**
  water sources (`specs/build.md`, `specs/fluids.md`).
- **Animated water shader.** Both river and deep water must have a **flowing,
  animated surface** — moving ripples/waves, scrolling normals or UVs, or vertex
  waves, with river flow reading as directional toward its outlet. A flat,
  unanimated blue polygon does **not** satisfy this; the water must visibly move.

Because vents sit high and water sits low, moving water to a boiler generally means
**pumping it uphill** — the central puzzle the flow rules build on
(`specs/fluids.md`).

## Geothermal vents

Scatter **`4`–`6` geothermal vents** across the terrain (tunable), each occupying a
single cell:

- Vents sit on the **high rock** — cells at elevation `5…7` on the rim or ridges —
  scattered so that no single wall or cliff denies **all** of them, and each is
  reachable by a terraced route for pipe-laying (`specs/build.md`).
- A vent cell is drawn with the **vent glow / hot core** colors and vents a wisp of
  heat/steam, so it reads as a geothermal site from the camera.
- A vent is the **only** place a **boiler** may be built (`specs/build.md`); the
  number of vents caps how much steam the map can ever make, so their placement is
  the strategic geography of the match. A vent with no boiler produces nothing.

## The Core

One **Core** — your objective — stands near the **center** of the caldera:

- It sits on a modest **raised central terrace** (elevation `3…4`), founded
  correctly on the generated terrain: level or step the cells under it as needed so
  it reads as **built on the ground**, not floating and not buried. It is a compact
  brass Holdfast structure a handful of cells across, flying Holdfast colors.
- The Core has a **health pool of `1000` HP** (tunable). It is the only loss
  condition: Slag that reach it deal damage to this pool (`specs/enemies.md`), and
  when it reaches `0` the run ends in **defeat** (`specs/waves.md`, `specs/flow.md`).
  The Core's health does **not** regenerate. The Core also produces your **funds**
  and can be **upgraded** (`specs/build.md`).
- The interior/approaches around the Core are open terrain you build and defend
  on; the Core itself is not a buildable surface.

## The breaches — where the Slag enter

The rim is broken by **two breaches** — low gaps in the crater wall on **two
different sides** of the caldera (for example one toward one corner and one toward
another, not adjacent), each a band of low, terrace-connected cells the Slag can
path through. Each match, the Slag spawn just **outside** the two breaches, on the
terrain surface, and advance **inward and downhill** toward the Core
(`specs/enemies.md`).

- Both breaches are active for the whole run; waves arrive from **both**
  (`specs/waves.md`), so the defense and the fluid network must cover **two
  approaches**, not one.
- The terrain between each breach and the Core must be **navigable on foot across
  terraces** (above) — the two approaches are the lanes the assault flows down,
  shaped and funneled by the cliffs, rivers, and deep water between the breach and
  the Core.

## Generation guarantees — a solvable, defensible match

Every generated match must be **playable and winnable in principle**. Whatever the
random layout, guarantee all of the following:

- **Reachable Core.** A terrace-navigable route exists from **each** breach to the
  Core (no breach is walled off from the Core by cliffs or deep water).
- **Reachable resources.** At least one **deep-water** body and at least **one
  river** exist and are reachable for building; at least **most** vents are
  reachable by a terraced pipe route, and enough vent + water capacity exists that
  a competent player can power a real defense (`specs/fluids.md`).
- **Buildable ground.** Enough open, terrace-connected, non-water, non-cliff cells
  exist between the breaches and the Core to route pipes and place towers to defend
  both approaches.
- **No degenerate maps.** No map that is trivially safe (the Core unreachable) or
  impossible (a breach with no route to the Core, or no reachable water/vents).

If a generation attempt fails a guarantee, regenerate rather than shipping a broken
map.
