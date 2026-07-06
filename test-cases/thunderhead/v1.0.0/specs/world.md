# Thunderhead — The world: islands, the cloud sea, and the murk

This file defines the battlespace: the procedurally generated mountainous terrain
and floating islands, the **cloud sea** and the concealing **murk** beneath it, how
that terrain shapes sight and movement, the boundaries, the two deployment zones,
and the generation guarantees. Coordinates and sizes are **world units** on the
axes from `specs/overview.md` (`X` and `Z` span the ground plane; `+Y` is up; the
**cloud line** at `Y ≈ 200` is the surface of the cloud sea). The units that fight
over this world are in `specs/units.md`; how they move across it is in
`specs/command.md`; how the terrain conceals is in `specs/recon.md`.

The **quality of the world you generate — how natural, varied, legible, and
watertight the islands are, how the cloud sea reads, and how sight and movement are
shaped by the relief** — is a central thing this case evaluates. There is
deliberately little steering on the *shape*; there is exact steering on the *rules*.

## The battlespace

The playable world is a fixed axis-aligned box:

- **Ground plane (`X`, `Z`): about `2048 × 2048`** (tunable — a larger or smaller
  footprint that keeps the proportions and the two-fleet engagement below is
  acceptable). The four vertical sides are **hard boundaries**.
- **Height (`Y`): `512`** (tunable). The floor (`Y = 0`) and a ceiling at the top
  are hard boundaries. Terrain occupies the lower part; the cloud sea sits across
  the middle; open sky fills the top.

Nothing — no ship, aircraft, submersible, or projectile — may leave the box: the
sides, floor, and ceiling contain the battle.

## The three altitude bands

The **cloud line** at `Y ≈ 200` is the world's sea level, and the battlespace reads
as three stacked bands:

- **The open sky** — everything **above** the cloud line (`Y ≳ 200`): clear air. It
  is where aircraft fly and where surface ships cruise, riding just along the
  **cloud-top**. Sight here is long and open (`specs/recon.md`).
- **The murk** — the dense cloud **below** the cloud line (`Y ≲ 200`), filling the
  air between the cloud-top and the terrain wherever the terrain lies below the
  cloud line. The murk is a **concealing medium**: sight and sensors are
  short-ranged inside it and cannot see across it from outside (`specs/recon.md`).
  It is the domain a submersible **dives** into to hide and stalk. The murk is
  **deep** over low valleys and basins (much room to dive) and **shallow** where the
  terrain rises near the cloud line (little or none).
- **The terrain** — the solid landform beneath it all: mountainous islands and
  suspended crags. Where the terrain rises **above** the cloud line, it breaks the
  cloud sea as a visible island or peak in the open sky; where it lies **below**,
  it is the floor of the murk.

The cloud line is a **soft threshold**, not a wall: units that can change altitude
pass through it (a submersible dives from the cloud-top down into the murk, an
aircraft may drop below it). What changes at the line is **concealment and sight**,
defined in `specs/recon.md` — not a barrier to movement.

## The cloud sea

The cloud sea is drawn as a **living surface** at the cloud line, and as the volume
of murk beneath it:

- **An animated cloud-top surface** spans the battlespace at `Y ≈ 200`, drawn in
  the cloud-sea colors from `specs/overview.md`, its surface **visibly moving** —
  rolling, drifting swells, not a flat static sheet. A still, unanimated plane does
  **not** satisfy this. The terrain's islands and floating crags pierce this surface
  where they rise above it.
- **The murk** below it is drawn as dense cloud thickening with depth (near-murk to
  deep-murk colors), so that the space beneath the cloud-top reads as a fog-filled
  volume a unit can sink into and be lost from sight, not empty air.
- The cloud sea is **not destructible or displaced** by units or weapons; it is the
  fixed medium the battle is fought through.

## Terrain — procedurally generated, non-destructible

You must **procedurally generate** the terrain each match. Requirements:

- **Mountainous relief.** The terrain is a solid landform of real, varied elevation
  — ranges, ridges, valleys, basins, and plateaus — rising from low valley floors
  (near `Y = 0`) through mid slopes to high **peaks** that stand **above** the cloud
  line (up to `Y ≈ 380`), so that some terrain is drowned in murk and some breaks
  the cloud sea as islands. The result must read as a coherent natural world of
  cloud-wreathed mountains, not random noise and not a flat plane.
- **Islands.** The terrain need **not** be one connected mass: it reads as an
  **archipelago** of islands and ridges separated by murk-filled straits and
  basins. The gaps between islands are the lanes the battle moves through.
- **Floating islands.** In addition to the grounded terrain, generate a **few
  suspended landmasses** — crags and rock shelves floating in the open sky and/or in
  the murk, disconnected from the ground below. These are a deliberate feature: they
  give **vertical cover** and break sightlines in the open air where the grounded
  terrain cannot reach. Each floating island is drawn as solid rock with a visible
  **underside**, and is as solid and static as the grounded terrain.
- **Watertight.** Every landmass — grounded or floating — is a **closed mesh**: no
  holes a unit falls through, no cracks in its surface, no torn faces. (A *floating*
  island is closed all the way around, underside included; it is intentionally not
  attached to the ground — that is the one exception to "grounded," not a license
  for gaps in a surface.)
- **Non-destructible.** Terrain does not change during a match. Weapons, ordnance,
  and wrecks do **not** carve, crater, or add to it — they affect units only. The
  terrain, the floating islands, and the cloud sea are **fixed at generation**, and
  movement and targeting may treat them as static (`specs/command.md`,
  `specs/combat.md`).
- **Procedural surface, not flat colors.** Modulate each surface with **procedural
  noise generated in code** (Perlin, simplex, value noise, or equivalent) so the
  terrain varies across and within its faces, in the terrain palette from
  `specs/overview.md`: **grass** on low and mid slopes, **rock/scree** on the high
  faces and cliffs, **snow** on the peaks that stand above the cloud line, dirt
  beneath, and bare rock on the floating islands and their undersides. You are given
  **no** texture files and must not fetch any — the variation is computed.

## How the terrain shapes the battle

The terrain is **not scenery** — its relief is the rules the battle is played
against. The build must make all of the following true (the detailed rules are in
the files named):

- **It blocks sight and fire.** Ridges, peaks, islands, and floating islands
  **occlude** line of sight and line of fire: a unit behind a mass cannot be seen or
  hit through it, and can use terrain as cover to break contact (`specs/recon.md`,
  `specs/combat.md`). Sensors are likewise blocked (`specs/recon.md`).
- **High ground sees farther.** The higher a unit's position, the longer its open
  sightline over the relief; a peak or a floating island is a commanding vantage
  (`specs/recon.md`).
- **It channels movement.** The straits and basins between islands funnel surface
  movement into lanes; the murk that fills the low terrain is where the dive domain
  exists at all, and it is **deep** enough to hide in only over the low valleys and
  basins (`specs/command.md`, `specs/units.md`).
- **It is read differently by each power.** The same relief rewards each power
  differently — the details are in `specs/factions.md` — but the terrain itself is
  **neutral**: it carries no power-specific structures or resources, only the sight,
  cover, vantage, and channeling above, which are available to all three.

## Deployment zones

Each match sets **two opposed deployment zones** — one for each fleet — near two
opposite edges (or opposite corners) of the battlespace, along the cloud-top:

- Each zone is a band of open cloud-top with room for a fleet to form up, clear of
  being walled in against the boundary. The fleets start at opposite ends and close
  the distance between them.
- A fleet's **reinforcements** arrive at its own zone's edge over the course of the
  battle (`specs/battle.md`).
- The layout must be **fair**: neither zone may be boxed in behind cliffs or crags,
  denied a route toward the enemy, or given a materially worse position than the
  other. The generated terrain sits **between** the two zones as contested ground.

## Generation guarantees — a fair, playable match

Every generated match must be **playable and fair**. Whatever the random layout,
guarantee all of the following:

- **A connected battlespace.** Open cloud-top routes exist between the two
  deployment zones, through and around the islands, so each fleet can bring its
  surface ships to bear on the other — no fleet is walled off.
- **Meaningful terrain.** The map contains real relief that matters: islands and
  ridges that break sightlines, at least a few **floating islands**, and at least
  some **deep-murk** valleys or basins with room to dive. Not a flat empty plane,
  and not an impassable wall of terrain across the battlespace.
- **Room to fight in all three bands.** There is open sky for aircraft, cloud-top
  lanes for surface ships, and deep murk for submersibles — none of the three
  domains is generated away.
- **Fair zones.** The two deployment zones are clear, reachable from each other, and
  not materially unequal (above).
- **No degenerate maps.** No map that walls the fleets apart, denies a domain, or
  gives one side an unbeatable position.

If a generation attempt fails a guarantee, **regenerate** rather than shipping a
broken map.
