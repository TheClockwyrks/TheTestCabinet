# World — the mine, its bands, its tiles, and the surface

This file defines the tiled world the game plays in: the grid and coordinate system,
the camera, the four **depth bands** and the Core chamber, every **tile kind**, how
ore, materials, and hazards are placed, and the **surface** and its six buildings.
It is referenced by `specs/character.md` (movement and drilling), `specs/mining.md`
(ore and materials), `specs/hazards.md` (gas, lava, the core), `specs/upgrades.md`
and `specs/rocket.md` (the surface buildings), and `specs/flow.md` (the loop). The
numeric values here are **fixed**; implement them exactly.

## The tile grid

The world is a grid of square **tiles**, each **80 x 80 logical pixels**.

- The mine is **32 columns** wide, `col` in `[0, 31]`. Columns `0` and `31` are the
  unminable **bedrock border** (below). Playable columns are `1..30`.
- The grid is **32 columns x 80 = 2560 px** wide — **wider than the 1280-wide
  viewport**, so only about **16 columns are on screen at once** and the world
  **scrolls horizontally** as the camera follows the miner across it. This is the
  Motherload framing: you can never see the whole width of the mine at once, which is
  what makes the **scanner** (`specs/mining.md`) worth having — a buried material off to
  one side is out of view until you scan toward it and dig across.
- Rows are numbered from the surface down: `row 0` is the **surface** (open ground /
  sky, where the buildings sit and the miner spawns), and the mine extends down to the
  **Core chamber** at the deepest row. **How deep** that is depends on the **world size**
  the player chose when starting the expedition (below): the **Standard** mine runs to
  `row 500`, the reference depth; a **Quick** mine is half as deep and a **Marathon** twice.
  In the Standard mine playable minable rows are `1..499` and `row 500` is the Core chamber;
  at any size the deepest row is the Core chamber and the rows just above it are minable.
- **Depth** is reported to the player in **meters**: each row below the surface is
  **5 m**, so `row r` is at depth `5 x r` m — the Standard Core chamber is at **2500 m**,
  a Quick mine's at **~1250 m**, a Marathon's at **~5000 m**.
- The camera follows the miner **in both axes** — horizontally across the wide mine and
  vertically down the shaft — clamped so it never scrolls past the world's edges (the
  bedrock borders on the sides, the Core-chamber floor at the bottom). Horizontally the
  miner stays centred; **vertically the camera LEADS the miner's motion by HOW LONG it has
  been moving in a direction** rather than pinning it dead-centre. The lead is driven by
  **time-in-direction, not speed**: while the miner keeps traveling one way the
  lead builds up **gradually at a fixed rate** (reaching its full reach after a
  couple of seconds of sustained motion), no matter whether the miner is
  drifting slowly or plunging fast — a long sustained fall and a slow steady
  descent build the **same** lead over the same time. A **brief hop** barely
  leads; only **sustained travel** walks the miner out toward the edge. When the
  miner is essentially **still** — at rest, or **boring straight down** (a braced
  motion with velocity ~0) — the lead **decays back to centre**, so a slow,
  static motion never jerks the view. When **descending**, the accumulated lead
  rides the miner **up toward the top of the view** — and a long enough plunge
  should carry the miner's leading edge to within **about one character height of
  the top edge of the screen** — so the floor of a shaft, a pocket, or a lava
  seam rushing up shows **earlier** and the player has time to react. When
  **climbing**, it rides **down toward the bottom** (symmetrically, to within
  about one character height of the bottom edge) so the surface (or a ceiling)
  comes into view in time to stop. At rest it eases back to centre. When the
  miner **reverses** (say, jetpacking up and then releasing to fall), the lead is
  left on the side it just came from; rather than crawl through centre at the
  slow build rate, it **unwinds toward centre noticeably faster** so the view
  keeps up with the turn, then eases out into the new direction's lead at the
  usual slow rate. The shift is smooth (both the gradual time-ramp and the
  per-frame ease toward the target), and it never fights the clamps above. There
  is **open sky above the surface with no ceiling** (`specs/character.md`):
  when the miner thrusts up out of the mine, the camera **follows it up** into that sky —
  there is nothing up there to reach, so the climb only burns fuel, but the miner is shown
  ascending rather than clipped at the top of the view. A tile at `(col, row)` occupies
  world-space
  `x in [80*col, 80*col + 80]`, `y = 80*row` in world coordinates, drawn at
  `x - cameraX`, `y - cameraY` on screen (the `y` offset by the `56 px` status bar).

## World size (Quick / Standard / Marathon)

When starting a **new expedition**, after choosing the mode (`specs/modes.md`) the player
chooses a **world size** — how **deep** the mine goes (`specs/flow.md`). The size **only**
scales the mine's **vertical extent**; it is **not** a difficulty mode and does **not**
change the four bands' identities, the hazards, the economy, the upgrade ladder, the rocket,
or how hard a given **fraction** of the descent is. It is the same game over a shorter or
a longer dig:

| Size | Depth vs Standard | Core depth (rows / m) | Feel |
| --- | --- | --- | --- |
| **Quick** | half | `~250` / `~1250 m` | a short expedition |
| **Standard** | reference | `500` / `2500 m` | the reference mine |
| **Marathon** | double | `~1000` / `~5000 m` | a long haul |

The rules that scale with the size:

- The **Core chamber** sits at the deepest row (`round(500 × scale)` — Quick `250`, Standard
  `500`, Marathon `1000`), and the world is that many rows deep. Depth in meters follows
  directly (`5 m` per row), so a Marathon Core genuinely reads **~5000 m** and a Quick one
  **~1250 m**.
- The **four bands stay equal quarters** of the descent, so at every size the mine is a
  quarter topsoil, a quarter rockbed, a quarter deepstone, a quarter coreshell (the Standard
  quarters below are the reference; Quick/Marathon are those spans scaled). Each band keeps
  its identity, hardness, hazards, and material.
- The depth-scaled difficulty — the **ore depth-frequency curves** (`specs/mining.md`) and
  the **gas-damage-with-depth** ramp (`specs/hazards.md`) — is expressed in terms of the
  **fraction of the descent**, so it is identical in shape at every size. A given
  proportional depth rolls the same ore mix and the same gas damage whether the mine is
  Quick, Standard, or Marathon; a size only stretches or compresses the descent, it never
  changes the envelope.

Everything else — tile size, the 32-column width, drill costs, fuel, cargo, weight, upgrade
prices, the five-part rocket — is **identical** across sizes. The chosen size is **persisted
in the save** so a restored expedition keeps its dimensions (`specs/flow.md`), and **Play
Again / Restart** replays the **same** size.

## The four depth bands + the Core chamber

The mine is banded by depth. Each band looks distinct (its own rock fill from the
palette, `specs/overview.md`), holds its own ore mix (`specs/mining.md`), escalates
in **hardness** (slower to drill, `specs/character.md`) and **hazard density**
(`specs/hazards.md`), and — for two of them — is the **only** place one of the
exotic materials is found (`specs/mining.md`, `specs/rocket.md`). The **Rows** column
below is the **Standard** mine; at a Quick or Marathon size these spans **scale
proportionally** (the bands remain equal quarters of the descent — see **World size** above).

| Band | Rows (Standard) | Rock fill | Tile hardness | Hazards | Exotic material | Gemstone |
| --- | --- | --- | --- | --- | --- | --- |
| **Surface** | `0` | camp / sky | — (open) | — | — | — |
| **Topsoil** | `1–125` | `#3a2c1f` | `1` (soft) | none | — | — (none) |
| **Rockbed** | `126–250` | `#3a3d44` | `2` | gas | **Resonite** (mid) | **Verdite** |
| **Deepstone** | `251–375` | `#20242c` | `3` | gas, lava | **Cryenite** (deep) | **Roselite** |
| **Coreshell** | `376–499` | `#3a1512` | `4` (very hard) | gas, dense lava | — | **Aurite** |
| **Core chamber** | `500` | glowing pit | bedrock walls | the Core Sample | **Core Sample** | — |

Each band below the topsoil holds its own **gemstone** (`specs/mining.md`) — a rarer, richer
find than ore, worth 3× and weighing 2× that band's signature ore.

The transition between bands is a visible change in the rock fill (and, in the
coreshell, a rising orange glow), so the player reads their depth from the world, not
only the meter. Band hardness sets each tile's **health** — topsoil `4`, rockbed `8`,
deepstone `12`, coreshell `16` — which the drill removes in **damage-per-hit** chunks, so
a deeper band takes more hits, and thus more **time and fuel**, to break
(`specs/character.md`, `specs/upgrades.md`): the topsoil yields to the starting drill in a
few hits, but the deepstone and coreshell take many hits on a weak drill (slow and
fuel-hungry) and need upgraded drills to dig at a workable speed and cost — one of the ways
the economy paces the descent.

## Tile kinds

Every grid cell is one of these kinds. A cell's kind is fixed at world generation
except that any **minable** cell becomes an **empty tunnel** once drilled.

- **Bedrock border** — columns `0` and `31`, the mine floor beneath the deepest minable
  row, and the walls of the Core chamber. **Unminable and impassable**: no drill breaks it
  and the miner cannot enter it. It bounds the playable space.
- **Earth / Rock / Deepstone / Coreshell** — the plain **minable dirt/rock** of each band.
  Drilling one (`specs/character.md`) removes it, leaving an **empty tunnel**, and yields
  nothing. It has **health** set by the band's hardness (topsoil `4` to coreshell `16`)
  that the miner's drill removes in **damage-per-hit** chunks, so the time and fuel to
  break it depend on the band's health and the miner's drill tier (`specs/upgrades.md`);
  the damage **persists** on the tile, so a partly-drilled tile keeps its progress if the
  cut is abandoned. Each band's rock must be drawn from **several interchangeable tile
  variants** (at least three), chosen per cell so that a wall of the same band does **not
  visibly repeat a single tiled texture** — the rock should read as natural, varied
  ground, not a grid of one identical stamp. The variants share the band's fill and
  palette (so they read as the same depth); only the clump/crack/fleck layout differs. The
  texture must read as **roughly uniform dirt/rock** — a fine, even grain across the whole
  tile, **not a few large clear blotches** that make the ground look patchy and artificial
  (`specs/assets.md`). A tile that has taken **drill damage** shows a **damage overlay**
  (a produced crack sprite whose frame deepens with the tile's damage fraction) so the dig
  visibly makes progress; because damage **persists**, a partly-drilled tile keeps its
  cracks even after the miner moves away (`specs/character.md`, `specs/assets.md`).
- **Unbreakable stone** — a hard, dark **boulder** tile scattered through the rock from
  the rockbed down (below) — the topsoil's first stratum stays clean, easy dirt.
  **Unminable and impassable** like the bedrock border — **no
  drill breaks it** — but, unlike the border, it sits *inside* the playable field as an
  **obstacle the player must route around**: a straight vertical shaft that runs into one
  must jog sideways to get past it. It reads clearly as a **different, harder material**
  than the surrounding dirt (a smooth, cold stone against the grainy band rock), so the
  player can tell at a glance that it will not yield to the drill. Generation never uses
  unbreakable stone to seal the only route down or to a material (below). No **drill**
  breaks it, but the **explosives** field supplies (Dynamite, Plastic Explosives) **can
  blast through it** — this is the "later addition" foreshadowed below realized
  (`specs/items.md`).
- **Ore vein** — a minable tile of the band's rock with an **ore deposit** in it
  (`specs/mining.md`). Drilling it removes the tile *and* adds that ore to cargo (if
  cargo has room). Ore veins are scattered through every band; the ore type and its
  odds are per band (`specs/mining.md`). An ore deposit reads as a **smear of mineral
  run through the dirt** — embedded in the rock and spreading toward the tile's edges
  (so adjacent ore cells read as one continuous vein), **not** a discrete nugget or dot
  sitting on top of the rock (`specs/mining.md`, `specs/assets.md`).
- **Gemstone** — a rarer minable tile holding this band's **gemstone**
  (`specs/mining.md`), from the **rockbed down** (none in the topsoil). It behaves like an
  ore vein — drilling it banks a unit of the gem into cargo — but it is worth **3×** and
  weighs **2×** the band's signature ore, and reads as a **cut, faceted jewel** (a
  brilliant-cut stone with a flat table, angled facets, and a glint) rather than the ore
  **smear**, so it is unmistakably a richer, rarer find at a glance (`specs/mining.md`,
  `specs/assets.md`).
- **Material node** — a minable tile holding one of the two **buried exotic
  materials**, **Resonite** (rockbed) or **Cryenite** (deepstone) (`specs/mining.md`,
  `specs/rocket.md`). Drilling it collects the material. Placement is **guaranteed
  but hidden** (below); the **scanner** points the player to the nearest one.
- **Gas pocket** — a hazard tile (`specs/hazards.md`): drilling into it triggers a gas
  explosion. Crucially, a gas pocket is **hidden** — it is drawn with the **same dirt
  texture as the surrounding band rock**, so a cursory glance cannot tell it from plain
  ground. Its **only** tell is a **very subtle produced particle effect** — a faint wisp
  of gas seeping from the tile that an alert, careful player can notice but that a hurried
  dig will drill straight into (`specs/hazards.md`, `specs/assets.md`). This is a
  deliberate departure from lava (which is plainly visible): gas is a trap you learn to
  read, not an obstacle you simply see and skirt.
- **Lava** — a hazard tile (`specs/hazards.md`): **not minable**, and touching it
  drains hull fast. The miner must route around it. It reads as **molten orange** and
  animates, but it is **fringed with the band's dirt** around the cell edges so a lava
  tile does not meet the surrounding rock at a hard, unnatural square seam — the molten
  pool sits *inside* a dirt border and adjacent lava cells flow together into one pool
  (`specs/assets.md`).
- **Empty tunnel** — a cell that is open space: either an original gap (the surface,
  a natural cavern) or a minable tile that has been drilled out. The miner falls
  through it under gravity and thrusts through it on the jetpack. A drilled tunnel is
  **slightly narrower than a full tile**: drilling clears the middle of the cell but
  leaves a **dirt lip around the edges** where the tunnel meets solid rock, with
  **rounded corners** — so a carved shaft reads as a hewn passage, not a stack of clean
  squares. Adjacent open cells **join** into one continuous tunnel (their shared lip
  disappears), but two open cells that touch **only at a corner** (diagonally) stay
  **two distinct holes**, separated by the rounded dirt between them, exactly as in
  Motherload (`specs/assets.md`).

A tile may also hold a **ground item** sitting on top of it — today only a **jettisoned
Core Sample** (`specs/items.md`), rendered on its tile with its countdown, ticking down to
a **location-aware detonation**. It is a one-way discard — it **cannot** be re-collected.
Ground items are not a tile kind; they ride on top of the open tunnel.

## Placing ore, materials, and hazards

The mine is **generated per game** within these rules; there is no single fixed map,
but every rule below is fixed. Generation must obey them so a run is always winnable:

- **Playable region.** Columns `1..30`, and every row from `1` down to the row just above
  the Core chamber (rows `1..499` in the Standard mine; scaled with the world size), are
  minable rock of the row's band, except the cells made into ore veins, material nodes,
  hazards, unbreakable stone, and the natural tunnels/caverns generation may carve. A
  **clear vertical shaft** need not be provided — the player drills their own way down.
- **Ore.** Ore veins are scattered through all four bands. Placement is
  **two-stage** (`specs/mining.md`): whether a cell is ore is **one
  constant-density roll** — the same fraction of rock in **every band at every
  depth**, so the ore-tile share never spikes in one stratum — and **which** ore
  it is comes from a weighted roll over each ore's **depth-frequency curve** at
  that row, so **4–5 ores are available in any band** and the mix **shifts
  within** a band (the bottom of a stratum is a different distribution than its
  top). Ore is the routine reward for digging; a player who digs steadily always
  finds ore to sell. **No ore veins spawn in the first three dirt rows** (rows
  `1`, `2`, `3`): the shallow topsoil right under the cave mouth stays plain
  rock, so a fresh expedition digs a little before the first payoff. (Materials
  and hazards are already absent that shallow; this rule is specifically about
  ore.)
- **Gemstones.** One **gemstone** per band from the **rockbed down** (`specs/mining.md`) —
  Verdite in the rockbed, Roselite in the deepstone, Aurite in the coreshell, and **none in
  the topsoil**. A gem is just an ore type in the same depth-curve roll above, but with a
  **tiny curve peak**, so it is a **genuinely rare find — well under 1 % of the band's
  tiles** — a treasure you stumble on only every so often, never several on screen at once,
  and a rich, heavy prize rather than a routine sight. (Because it shares the single ore
  density roll, gems add no density of their own — the ore-tile share stays constant.) Like
  ore they never spawn in the first three dirt rows.
- **Unbreakable stone.** Boulders of unbreakable stone are scattered through the
  playable rows from the **rockbed** down — never in the topsoil first stratum —
  growing **denser with depth** so the deep
  bands are more of a maze. They are never so dense as to wall off a band: generation
  must **never seal the only route** down, to a material node, or to the Core with
  unbreakable stone (as with lava, below) — a determined driller can always find a
  diggable path through the surrounding rock, even if it means a shaft that jogs sideways
  rather than running straight down. They force the player to **route around** them — or
  **blast through** them with the explosives field supplies (`specs/items.md`) — rather
  than always digging a perfectly straight hole.
- **Exotic materials — guaranteed but hidden.** **Exactly one** Resonite node
  exists somewhere in the **rockbed** band and **exactly one** Cryenite node exists
  somewhere in the **deepstone** band, at a **random position within that band** —
  never at a fixed tile, but **always present and always reachable** (a run can never
  lack a material it needs, and the connectivity repair below guarantees a diggable path
  to it). Only **one** of each material is needed to win (`specs/rocket.md`), so there is
  no surplus: with a single node per band, the **scanner** (`specs/mining.md`) — which
  points to the nearest uncollected material — is what makes the material findable and
  the run winnable. The Terraria model: randomly placed, reliably locatable.
- **The Core Sample** is not scattered: it sits in the **Core chamber** at the deepest row
  (`row 500` in the Standard mine; the scaled bottom at other sizes), reachable only by
  drilling all the way down (`specs/hazards.md`, `specs/rocket.md`).
- **Hazards.** Gas pockets appear from the rockbed down and lava from the deepstone
  down, denser with depth (`specs/hazards.md`), scattered so the deep dig is a real
  gauntlet — but generation must never seal the only route to a material or to the
  Core with an unbroken wall of lava; a determined driller can always get through.

## The surface

`Row 0` is the **surface camp**: a strip of scrapped ground under a dim dusk sky
(`specs/overview.md` palette), where the miner **spawns** and returns to between
digs, and where the six **buildings** stand. A shallow **cave mouth** in the camp
floor is the way down into `row 1`. The surface is open space the miner walks and
hovers across; there is no digging up here.

Six buildings sit on the surface, each a produced sprite (`specs/assets.md`) the miner
activates by standing at it. Most open an **overlay panel** (`specs/controls.md`,
`specs/flow.md`); the **Save Pad** has no menu — activating it saves on the spot:

- **Fuel Depot** — where you **buy** fuel and hull repair. Nothing refills on its own;
  at the depot you spend **Credits** to add **fuel** (per unit) and to **repair hull**
  (per point), up to your current maxima (`specs/flow.md`, `specs/character.md`). The
  panel lets you buy a fixed increment or **fill / repair to full** (paying only for
  what is missing, and only as far as you can afford). The depot is a **shop**, not a
  free top-up — refuel and repair compete for Credits with upgrades and rocket parts.
- **Ore Market** — **sells** the ore in your cargo for Credits at the listed values
  (`specs/mining.md`, `specs/flow.md`), emptying the cargo.
- **Save Pad** — the checkpoint pad where you **save** the expedition to its single save
  slot; the **only** way to save. It has **no menu**: activating the pad (key or click)
  banks progress on the spot, with a note either way (`specs/flow.md`, `specs/modes.md`).
- **Upgrade Shop** — buys the next tier on any of the seven **upgrade tracks** — fuel
  tank, drill, cargo bay, hull, jetpack, radiator, scanner — for Credits
  (`specs/upgrades.md`). It sells **only** upgrades, not consumables.
- **Supply Depot** — buys the six single-use **field supplies** (explosives, teleporters,
  nanobots, emergency fuel) for Credits (`specs/items.md`). Its own building, separate from
  the Upgrade Shop.
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
