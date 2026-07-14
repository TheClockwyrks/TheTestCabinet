# Arc Foundry — The board: the yard grid, waypoint mazing, the maps, and the HUD

This file defines the playfield: the **tile grid** that covers the yard, the
uniform **component footprint**, the **waypoint pathing + mazing model** (how the
Load crosses the yard, how every component and slag wall is a wall, the never-seal
rule, and live re-pathing), the **three maps** and their exact waypoint
coordinates, and where the **status bar** and **build panel** sit. It builds on the
stage and regions in `specs/overview.md` and connects to the Load
(`specs/enemies.md`), the components (`specs/towers.md`), the build loop
(`specs/build.md`), the controls (`specs/controls.md`), and the flow
(`specs/flow.md`).

All positions, sizes, and ranges are **logical pixels** on the fixed `1280 x 720`
stage from `specs/overview.md`. The board occupies `x` in `[0, 1000]`, `y` in
`[56, 720]` (`1000 x 664`) and is shown **whole** — there is no scrolling camera;
the entire yard (every waypoint, the Entry, the Collector, and everything built on
it) is visible at once, whichever map is in play.

## The tile grid

The board carries a **50-column x 33-row** grid of **`20 x 20` px** tiles
(`1000 x 660`), anchored at the board's top-left `(0, 56)`. Columns `c = 0..49`,
rows `r = 0..32`. The 4-px strip `y` in `[716, 720]` is board frame, not playable.

- Tile `(c, r)` spans `x` in `[20c, 20c + 20]` and `y` in `[56 + 20r, 56 + 20r +
  20]`; its **center** is `(20c + 10, 56 + 20r + 10)`.
- The Load walks **between tile centers**.
- A faint grid is drawn over the yard substrate at all times so tiles read
  (`specs/overview.md` fixes the palette).

Each tile is in one of three states:

- **Open** — empty yard the Load can cross, and buildable (subject to the
  never-seal rule below).
- **Blocked** — occupied by part of a component or slag footprint. It is now a
  **wall** (see **Mazing** below).
- **Fixed-blocked** — a map's pre-placed housing (`Map C`, below): **impassable and
  never buildable**. It is a permanent wall the player can neither remove nor build
  on.

## Component footprint (uniform)

**Every component and every slag wall occupies a uniform `2 x 2` tile footprint
(`40 x 40` px)**, anchored by its **top-left tile** `(col, row)`, covering tiles
`col..col + 1` by `row..row + 1`. Legal anchors are `col` in `0..48`, `row` in
`0..31`. The placement preview snaps the `2 x 2` block to the grid under the cursor
(`specs/controls.md`). A component's **center** — used for range, targeting, and
drawing — is `(20 * (col + 1), 56 + 20 * (row + 1))`. Footprints are uniform at
**every** quality tier; there are no size variants (`specs/towers.md`).

## Waypoint pathing and mazing

There is **no fixed track**. The Load pathfinds across the open yard, and **every
component and every slag wall is a wall**: building one blocks its `2 x 2`
footprint, so you lengthen the Load's route by building structures it must crawl
around. This is the core of the game — you build the maze. But movement is
**constrained by an ordered chain of waypoints**.

### Ordered waypoints

Each map defines an **ordered chain** of checkpoints:

```
Entry (E) -> WP1 -> WP2 -> ... -> WPk -> Collector (C)
```

Every non-flying unit must reach each waypoint **in sequence**: it heads to `WP1`
first, then `WP2`, and so on, finally to the **Collector**, where it **grounds out
(leaks)** — costing Grid Integrity (`specs/flow.md`). A unit never skips or reorders
waypoints. Waypoints are **tiles**: the unit targets the waypoint tile's center.
The **Entry** and **Collector** sit on a board edge (`specs/overview.md` fixes the
Entry vent and Collector sink art and the sense of flow toward the collector).

### Shortest open route between consecutive waypoints

Between its **current waypoint target** and the **next** one, a unit takes the
**shortest open route around the walls** — grid pathfinding (A\*/BFS) over Open
tiles between the two waypoint tiles. It does **not** globally optimize the whole
chain; it always solves *this leg* (current position / last waypoint reached → next
waypoint), then the next leg, and so on. Extending a leg's shortest route by walling
is how you maze.

Progress "toward the Collector" — the ordering used for the standard **`first`**
target (`specs/towers.md`) — is measured as **waypoint index reached, then remaining
path length to the next waypoint**: the unit furthest along the chain (highest
waypoint index, and among ties the shortest remaining distance to its next waypoint)
is the "first" target.

### Diagonal rule

Movement steps to an orthogonally or diagonally adjacent Open tile. A **diagonal
step is allowed only when both orthogonally-adjacent tiles it cuts past are also
Open** — the Load never squeezes through the corner gap between two
diagonally-touching walls.

### The never-seal rule

A placement is **refused** if, after it were placed, **any** segment of the
waypoint chain (`E->WP1`, `WP1->WP2`, …, `WPk->C`) would have **no** open route,
**or** if it would trap a unit already on the floor with no remaining route to its
next waypoint. **You can never fully block a segment.** The build UI shows a refused
placement as invalid and does not place it (`specs/controls.md`). Because every
segment must stay open, the maze can only ever *lengthen* a route, never close it.

### Live re-path

The floor's pathing is **recomputed live** whenever it changes — a component
stamped, slagged, combined (which frees the consumed footprint), or sold
(`specs/build.md`, `specs/towers.md`) **re-routes every unit currently walking**,
smoothly redirecting it from where it stands (no teleporting or snapping backward). A
unit already past a junction follows the new shortest route for its current leg from
its current tile.

### Flyers

A **flyer** (the Filament, `specs/enemies.md`) **ignores the maze**: it flies in
straight lines from the Entry through each waypoint in order to the Collector,
passing over every component and wall. Walls cannot slow or redirect it. Any
component in range can still fire at it while it is over the yard, but because it
bypasses the maze its exposure window is short — so flyer coverage must sit near the
straight-line waypoint path.

## The maps

Arc Foundry ships **three maps**, chosen at a **MAP SELECT** screen
(`specs/flow.md`, `specs/modes.md`). Every map plays the **same** campaign, economy,
roster, and scaling — the **topology** (waypoint placement and any fixed housings),
not the numbers, is what differs. Coordinates are **tile `(col, row)`** on the
`50 x 33` grid. The Entry and Collector are on board edges.

### Map A — "The Substation" (original layout)

A wide serpentine that hugs the yard's perimeter; the classic Arc Foundry maze where
you fold each long edge-leg back on itself.

| Checkpoint | Tile | Edge |
| --- | --- | --- |
| **Entry** | `(0, 4)` | left |
| WP1 | `(47, 4)` | — |
| WP2 | `(47, 28)` | — |
| WP3 | `(2, 28)` | — |
| WP4 | `(2, 16)` | — |
| **Collector** | `(49, 16)` | right |

No fixed housings. Five long, near-straight legs (top, right, bottom, up-left,
middle) reward one big folded maze across the open center.

### Map B — "The Switchyard" (different waypoints)

A crossing star whose legs cut diagonally through the **center** repeatedly, so the
middle of the yard is contested four times over — a completely different mazing
problem from Map A's edge-hugging.

| Checkpoint | Tile | Edge |
| --- | --- | --- |
| **Entry** | `(25, 0)` | top |
| WP1 | `(2, 30)` | — |
| WP2 | `(47, 2)` | — |
| WP3 | `(2, 2)` | — |
| WP4 | `(47, 30)` | — |
| **Collector** | `(25, 32)` | bottom |

No fixed housings. The legs criss-cross the center, so the premium mazing real estate
is the middle band, not the edges.

### Map C — "The Transformer Yard" (different waypoints **and** pre-blocked tiles)

Two large fixed **transformer housings** split the yard on a diagonal; the center
waypoint forces the Load through the gap between them, and the housings pre-shape the
maze before the player builds a single wall.

| Checkpoint | Tile | Edge |
| --- | --- | --- |
| **Entry** | `(0, 2)` | left |
| WP1 | `(48, 2)` | — |
| WP2 | `(24, 16)` | center |
| WP3 | `(48, 30)` | — |
| **Collector** | `(0, 30)` | left |

**Fixed-blocked housings** (Fixed-blocked tiles: impassable, never buildable, drawn
as steel transformer boxes — `specs/overview.md`, `specs/assets.md`):

- **Housing 1:** tiles `col 12..19` by `row 6..12`.
- **Housing 2:** tiles `col 30..37` by `row 20..26`.

The `WP2` center passage is a natural chokepoint between the housings; the housings
block off big rectangles, so the player mazes the corridors around them rather than an
open field. The base route `E->WP1->WP2->WP3->C` stays open around both housings.

Every map exposes its **Entry** (a blown feeder vent, glowing) and **Collector** (a
grounding sink, hazard-marked), and renders a clear sense of **flow direction** toward
the Collector (`specs/overview.md`, `specs/assets.md`).

## Placement legality

A component or slag wall may be placed **only** where its full `2 x 2` footprint is
legal:

- **Every tile in the footprint is Open** — no tile may already be Blocked (another
  component or slag) or Fixed-blocked (a housing), and no tile may currently be
  occupied by a Load unit.
- **The footprint is in bounds** — the anchor is a legal `2 x 2` block (`col` in
  `0..48`, `row` in `0..31`).
- **The never-seal rule holds** — the placement must not leave any waypoint segment
  with no open route, nor trap any walking unit (above).

The placement preview snaps the `2 x 2` block to the grid, shows those tiles, and
clearly marks a legal spot versus a refused one (occupied, out of bounds,
never-seal, or unaffordable) — see `specs/controls.md`. Selling a component or slag
wall reopens every tile in its footprint immediately and the floor re-paths
(`specs/towers.md`, `specs/build.md`).

## Range and targeting geometry

A component's **range** is a radius in logical pixels measured from its **center**
(above); a Load unit is targetable while the point it occupies lies within that
radius. A component fires **automatically** at its fire rate at a valid in-range
unit — there is no manual trigger — and holds fire when nothing is in range. The
firing head **rotates to face its current target**, and each shot is a **visible
traveling projectile / arc that carries the hit on impact** (not hitscan). By
default a damage component fires at the in-range unit **furthest along the waypoint
chain** (the "first" target, above); its targeting priority is selectable per
component from its inspector. The stat values (range per type × quality), the chain
and splash geometry, and the targeting priorities live in `specs/towers.md`. When a
component is selected or held, draw its **range** as a ring so the player can see
what it covers (`specs/controls.md`).

## Top status bar

The **top status bar** (`y` in `[0, 56]`, full width — `specs/overview.md`) carries
the at-a-glance run state, drawn in code (`specs/assets.md`; only its small icons may
be produced sprites):

- **Charge** — current spendable Charge (`specs/flow.md`), with its icon.
- **Grid Integrity** — remaining integrity, with its icon; it turns to the alert
  color as it runs low.
- **Wave** — `WAVE n / N` (the current wave over the run's total), with a read of the
  current wave's progress or the between-wave build-phase countdown, and a clear
  **PAUSED** read while the game is paused in place (`specs/flow.md`,
  `specs/controls.md`).
- **Global controls** — the game **speed** toggle and its current setting, a **pause**
  toggle that pauses and resumes **in place** (freezing the game without a menu while
  the board stays interactive) and reflects the paused state, and a **mute** toggle
  (`specs/controls.md`, `specs/flow.md`).

## Right build panel

The **right build panel** (`x` in `[1000, 1280]` (`280` px wide), `y` in `[56, 720]`
— `specs/overview.md`) is where the player builds and inspects, drawn in code (its
small icons may be produced sprites). It is always fully visible and holds, top to
bottom:

- **The scrap-press** — the **STAMP** control (`specs/build.md`), showing its `18`
  Charge cost and the remaining stamps of the `7`-per-level allowance. Stamping rolls
  a random component type at a random quality (`specs/build.md`).
- **The selected-component inspector** — when a placed component is selected, this
  area shows its type, its **quality tier**, and its live stats (damage, range, fire
  rate, targeting), plus its **SLAG / SELL / COMBINE** and **targeting** controls —
  `COMBINE` shown only when a matching component (same type and quality) exists
  elsewhere on the board (`specs/build.md`, `specs/towers.md`, `specs/controls.md`).
- **The next-wave preview** — when nothing is selected, this area shows the coming
  wave's types so the player can re-shape the maze for it (`specs/enemies.md`,
  `specs/flow.md`).
- **The wave control** — the **START** button in the untimed opening build phase
  before Wave 1 and the **send-early** action between waves (which reads the
  build-phase countdown and pays the early-send bonus when pressed early,
  `specs/flow.md`), with a game-speed toggle as an alternative to the status bar's.

On the board, each Load unit shows a health bar, each component reads as its type and
**quality tier** (finish and VFX escalate by tier — `specs/towers.md`,
`specs/assets.md`), and a selected or held component shows its **range ring**. The
yard itself never shows persistent UI chrome over the play area beyond the grid, the
components and slag, the Load, projectiles and VFX, and small per-unit health bars;
all panels and controls live in the build panel. The HUD's meaning — Charge, Grid
Integrity, waves, scoring — is defined in `specs/flow.md`; this file fixes only where
it sits.
