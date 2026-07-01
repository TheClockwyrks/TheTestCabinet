# Playfield

## Overview

This file defines the geometry of the reactor floor and the rules that govern
it: the tile grid, where the surge enters and leaves, how towers wall the floor,
how the surge finds its path through the maze you build, and the build-panel/HUD
layout. All positions and sizes are in the logical-pixel coordinate system from
`specs/overview.md` (a fixed `1280 x 720` stage; the floor is `x` in `[0,
1000]`, `y` in `[0, 720]`; the build panel is `x` in `[1000, 1280]`).

## Tile Grid

The reactor floor is a grid of 20 x 20 logical-pixel tiles, **50 columns**
(`c = 0..49`) by **36 rows** (`r = 0..35`). Tile `(c, r)` spans `x` in `[20c,
20c + 20]` and `y` in `[20r, 20r + 20]`; its **center** is at `(20c + 10, 20r +
10)`. Every tower occupies a snapped **2 x 2 tile footprint** centered on a
grid intersection, so the player's cursor feels like it is placing the center
of the tower. A tower centered on intersection `(i, j)` occupies the four tiles
that meet there: `(i - 1, j - 1)`, `(i, j - 1)`, `(i - 1, j)`, and `(i, j)`,
with `i = 1..49` and `j = 1..35`; its tower center is at `(20i, 20j)`. The
surge walks between tile centers. The faint grid (`#23272e`) is drawn over the
floor (`#15181d`) at all times so the player can read tiles.

Each tile is in one of these states:

- **Open** — empty floor the surge can walk on. A tower can be built only where
  all four tiles in its 2 x 2 footprint are open.
- **Blocked** — occupied by part of a tower footprint (it is now a wall; see
  Mazing below).
- **Intake** or **exhaust** — a fixed edge portal (below). The surge walks
  *through* these; no tower may be built on them.

## Intakes and Exhausts

The surge enters at two intakes and leaves at two exhausts, each a
**four-tile** opening at the middle of an edge:

- **Left intake** — the left edge, rows `r = 16..19` (tiles `(0, 16)` through
  `(0, 19)`). The surge appears here moving right onto the floor.
- **Top intake** — the top edge, columns `c = 24..27` (tiles `(24, 0)` through
  `(27, 0)`). The surge appears here moving down onto the floor.
- **Right exhaust** — the right edge, rows `r = 16..19` (tiles `(49, 16)`
  through `(49, 19)`). Reaching here leaks the surge (see `specs/flow.md`).
- **Bottom exhaust** — the bottom edge, columns `c = 24..27` (tiles `(24, 35)`
  through `(27, 35)`).

Because the floor is a wide rectangle and the intakes and exhausts sit at the
edge midpoints, the routes are **asymmetric**: an intruder entering at the top
has a shorter run to the bottom exhaust than to the right one, and vice versa.
The player must account for one exhaust being nearer than the other when
shaping the maze. These four portals are fixed for the whole game; only their
visual state (idle vs. surge passing through) changes.

Intakes glow cool blue (`#5f9bd6`); exhausts are hazard-striped and read as
dangerous (`#ff5a3c`).

## Tower Construction and Mazing

There is no fixed path. The surge pathfinds across the open floor, and
every tower is *also* a wall: building one blocks its 2 x 2 footprint, so you
lengthen the surge's route by building structures it must walk around. This is
the core of the game — you build the maze.

- A tower may be built only where its full **2 x 2 footprint** is open. No tile
  in that footprint may be an intake, an exhaust, already occupied by another
  tower, or currently occupied by a surge unit. The placement preview snaps the
  cursor to the nearest valid interior grid intersection and shows the four
  tiles surrounding that intersection.
- **You can never seal the floor.** A placement is rejected if, after it would
  be placed, any intake would have no path to **any** exhaust, or if it would
  trap a surge unit already on the floor with no remaining route out. The build
  UI must show a blocked placement as invalid (`#ff4d4d`) and refuse it, rather
  than letting the player wall the surge in. There must always be at least one
  open route from each intake to an exhaust.
- Selling a tower (see `specs/towers.md`) reopens all four tiles in its
  footprint immediately and the surge re-paths.

## Surge Movement

The surge walks the **shortest available route** from its intake to an exhaust:

- Movement is on the tile grid between tile centers. A unit may step to an
  orthogonally or diagonally adjacent open tile, but a diagonal step is
  allowed only when **both** orthogonally-adjacent tiles it cuts past are also
  open — the surge never squeezes through the corner gap between two
  diagonally-touching towers.
- Each unit heads for the nearest reachable exhaust by path distance (not
  straight-line distance), so the two intakes' streams may favor different
  exhausts depending on the maze. Ties may be broken however you like, but
  it must be done consistently.
- The path is **recomputed live** whenever the floor changes — a tower built or
  sold re-routes every unit currently walking, smoothly redirecting it from
  where it stands (no teleporting or snapping backwards). Units already past a
  junction follow the new shortest route from their current tile.
- **Flyers are the exception.** Flying surge units (see `specs/creeps.md`)
  ignore the maze entirely: they travel in a straight line from their intake to
  the nearest exhaust, passing over towers and walls. Any emitter can hit them
  if they are in range, but the Flak is air-only and exists for dedicated flyer
  coverage.

## Build Panel and HUD

The build panel occupies the right strip (`x` in `[1000, 1280]`, full
height), drawn on the panel background (`#1b1f26`) and separated from the floor
by a divider (`#2c323c`). It is always fully visible and holds, top to bottom:

- **Status readouts** — the current money (in `#ffcf4d`), the lives
  remaining, and the wave indicator (`WAVE n / N`, plus a small progress
  read of the current wave). See `specs/flow.md` for what each means.
- **The shop** — a grid of buyable towers, one button per type (the six emitters
  plus the Forge and Vent of `specs/towers.md`), each showing the tower's icon,
  name, and cost. A type the player cannot currently afford is shown disabled.
  Selecting a shop entry arms placement (see `specs/controls.md`).
- **The selected-tower inspector** — when a placed tower is selected, this area
  shows its type and level, its current stats (range, damage or effect, fire
  rate), its live heat read (the same heat value drawn on the tower footprint,
  shown here as a labeled bar from `0%` to redline), and **Upgrade** (with its
  cost) and **Sell** (with its refund) actions. When nothing is selected it
  shows a brief hint or the next-wave preview.
- **Wave controls** — a **Send next wave** action (with its early-send bonus;
  see `specs/flow.md`), a game-speed toggle (`1x` / `2x`), and **Pause**.

The floor itself never shows persistent UI chrome over the play area beyond the
grid, the towers, the surge, transient range/placement indicators, and small
per-unit health bars; all panels and controls live in the build panel. The HUD's
meaning — money, lives, waves, scoring — is defined in `specs/flow.md`; this
file fixes only where it sits.
