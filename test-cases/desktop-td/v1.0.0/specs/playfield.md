# Meltdown — The reactor floor: grid, intakes and exhausts, mazing, and HUD

This file defines the geometry of the reactor floor and the rules that govern
it: the tile grid, where the surge enters and leaves, how towers wall the floor,
how the surge finds its path through the maze you build, and the build-panel/HUD
layout. All positions and sizes are in the logical-pixel coordinate system from
`specs/overview.md` (a fixed `1280 x 720` stage; the floor is `x` in `[0,
1000]`, `y` in `[0, 720]`; the build panel is `x` in `[1000, 1280]`).

## The tile grid

The reactor floor is a grid of **40 x 40** logical-pixel tiles, **25 columns**
(`c = 0..24`) by **18 rows** (`r = 0..17`). Tile `(c, r)` spans `x` in `[40c,
40c + 40]` and `y` in `[40r, 40r + 40]`; its **center** is at `(40c + 20, 40r +
20)`. Every tower occupies exactly one tile, snapped to the grid, and the
surge walks between tile centers. The faint grid (`#23272e`) is drawn over the
floor (`#15181d`) at all times so the player can read tiles.

Each tile is in one of these states:

- **Open** — empty floor the surge can walk and a tower can be built on.
- **Blocked** — occupied by a tower (it is now a wall; see Mazing below).
- **Intake** or **exhaust** — a fixed edge portal (below). The surge walks
  *through* these; no tower may be built on them.

## Intakes and exhausts

The surge enters at two **intakes** and leaves at two **exhausts**, each a
**two-tile** opening at the middle of an edge:

- **Left intake** — the left edge, rows `r = 8` and `r = 9` (tiles `(0, 8)` and
  `(0, 9)`). The surge appears here moving right onto the floor.
- **Top intake** — the top edge, columns `c = 12` and `c = 13` (tiles `(12, 0)`
  and `(13, 0)`). The surge appears here moving down onto the floor.
- **Right exhaust** — the right edge, rows `r = 8` and `r = 9` (tiles `(24, 8)`
  and `(24, 9)`). Reaching here leaks the surge (see `specs/flow.md`).
- **Bottom exhaust** — the bottom edge, columns `c = 12` and `c = 13` (tiles
  `(12, 17)` and `(13, 17)`).

Because the floor is a wide rectangle and the intakes and exhausts sit at the
edge midpoints, the routes are **asymmetric**: an intruder entering at the top
has a shorter run to the bottom exhaust than to the right one, and vice versa.
The player must account for one exhaust being nearer than the other when shaping
the maze. These four portals are fixed for the whole game; only their visual
state (idle vs. surge passing through) changes.

Intakes glow cool blue (`#5f9bd6`); exhausts are hazard-striped and read as
dangerous (`#ff5a3c`).

## Mazing — towers are walls

There is no fixed path. The surge pathfinds across the open floor, and
**every tower is also a wall**: building one blocks its tile, so you lengthen
the surge's route by building structures it must walk around. This is the core
of the game — you build the maze.

- A tower may be built only on an **open** tile. It may not be built on an
  intake, an exhaust, a tile already holding a tower, or a tile a surge unit is
  currently standing on.
- **You can never seal the floor.** A placement is rejected if, after it,
  any intake would have no path to **any** exhaust, or if it would trap a
  surge unit already on the floor with no remaining route out. The build UI must
  show a blocked placement as invalid (`#ff4d4d`) and refuse it, rather than
  letting the player wall the surge in. There must always be at least one open
  route from each intake to an exhaust.
- Selling a tower (see `specs/towers.md`) reopens its tile immediately and the
  surge re-paths.

## How the surge paths

The surge walks the **shortest available route** from its intake to an exhaust:

- Movement is on the tile grid between tile centers. A unit may step to an
  orthogonally or diagonally adjacent open tile, but a diagonal step is
  allowed only when **both** orthogonally-adjacent tiles it cuts past are also
  open — the surge never squeezes through the corner gap between two
  diagonally-touching towers.
- Each unit heads for the nearest reachable exhaust by path distance (not
  straight-line distance), so the two intakes' streams may favor different
  exhausts depending on the maze. Ties may be broken however you like, but
  consistently.
- The path is **recomputed live** whenever the floor changes — a tower built or
  sold re-routes every unit currently walking, smoothly redirecting it from
  where it stands (no teleporting, no snapping backward). Units already past a
  junction follow the new shortest route from their current tile.
- **Flyers are the exception.** Flying surge units (see `specs/creeps.md`)
  ignore the maze entirely: they travel in a straight line from their intake to
  the nearest exhaust, passing over towers and walls. Only anti-air towers can
  hit them. Build a maze all you like — it does nothing to a flyer.

This "build-the-maze, but it can always get through, and flyers ignore it" rule
set is the strategic spine the heat system sits on top of.

## The build panel and HUD

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
  rate), its live heat read (the same heat value drawn on the tile, shown
  here as a labeled bar from `0%` to redline), and **Upgrade** (with its cost)
  and **Sell** (with its refund) actions. When nothing is selected it shows a
  brief hint or the next-wave preview.
- **Wave controls** — a **Send next wave** action (with its early-send bonus;
  see `specs/flow.md`), a game-speed toggle (`1x` / `2x`), and **Pause**.

The floor itself never shows persistent UI chrome over the play area beyond the
grid, the towers, the surge, transient range/placement indicators, and small
per-unit health bars; all panels and controls live in the build panel. The HUD's
meaning — money, lives, waves, scoring — is defined in `specs/flow.md`; this
file fixes only where it sits.
