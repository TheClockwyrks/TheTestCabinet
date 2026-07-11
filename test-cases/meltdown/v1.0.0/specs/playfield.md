# Playfield

## Overview

This file defines the geometry of the reactor: the **casing wall** that encloses
the floor, the tile grid inside it, where the surge enters and leaves through
openings in that wall, how towers wall the floor, how the surge finds its path
through the maze you build, and the build-panel/HUD layout. All positions and
sizes are in the logical-pixel coordinate system from `specs/overview.md` (a fixed
`1280 x 720` stage). The stage splits into two regions:

- **The reactor** — the left region, `x` in `[0, 986]`, `y` in `[0, 720]`: a
  `950 x 684` **reactor floor** ringed by an **18-px casing wall** (below). The
  floor itself is `x` in `[18, 968]`, `y` in `[18, 702]`.
- **The build panel** — the right strip, `x` in `[986, 1280]` (`294` px wide),
  full height.

## The Casing Wall

The reactor floor is enclosed by a solid **casing wall** — an `18`-px band ringing
the `950 x 684` floor on all four sides (its outer edge at `x` in `[0, 986]` and
`y` in `[0, 720]`; its inner edge at the floor boundary). The casing is
**impassable and is not part of the tile grid**: the surge can never cross it, and
no tower is ever built on it. The floor is therefore a **fully enclosed arena** —
the surge can enter or leave *only* through the four **openings** cut into the
casing (the vents and exhausts, below).

Draw the casing as the reactor's **heavy steel containment shell** (`#3b434f`) —
clearly a solid, raised wall, distinctly lighter than the dark floor so it never
reads as empty space or a gap — with a **lit inner rim** (`#565f6d`) along the edge
where it meets the floor. It frames the floor and reads unmistakably as the wall of
the reactor, unbroken except at its four openings.

## Tile Grid

The reactor floor is a grid of **19 x 19** logical-pixel tiles, **50 columns**
(`c = 0..49`) by **36 rows** (`r = 0..35`), forming the `950 x 684` play area
whose top-left corner sits at the floor origin `(18, 18)`, just inside the casing.
Tile `(c, r)` spans `x` in `[18 + 19c, 18 + 19(c + 1)]` and `y` in `[18 + 19r,
18 + 19(r + 1)]`; its **center** is at `(18 + 19c + 9.5, 18 + 19r + 9.5)`. Every
tower occupies a snapped **2 x 2 tile footprint** centered on a grid intersection,
so the player's cursor feels like it is placing the center of the tower. A tower
centered on intersection `(i, j)` occupies the four tiles that meet there:
`(i - 1, j - 1)`, `(i, j - 1)`, `(i - 1, j)`, and `(i, j)`, with `i = 1..49` and
`j = 1..35`; its tower center is at `(18 + 19i, 18 + 19j)`. The surge walks between
tile centers. The faint grid (`#23272e`) is drawn over the floor (`#15181d`) at all
times so the player can read tiles.

Each tile is in one of these states:

- **Open** — empty floor the surge can walk on. A tower can be built only where
  all four tiles in its 2 x 2 footprint are open.
- **Blocked** — occupied by part of a tower footprint (it is now a wall; see
  Mazing below).

The **vents and exhausts are openings in the casing wall, not tiles** (below); the
floor's edge tiles are ordinary Open floor that the surge walks onto and that
towers may occupy (subject to the never-seal rule).

## Vents and Exhausts

The surge enters through two **vents** and leaves through two **exhausts** — each an
**opening cut into the casing wall** at the middle of an edge, aligned to a run of
tile rows or columns. The two **side** openings (left vent, right exhaust) are
**four tiles wide** (`4 x 19 = 76` px); the two **top/bottom** openings (top vent,
bottom exhaust) are **twice as wide — eight tiles** (`8 x 19 = 152` px) — each
centred on the floor's middle column. A unit appears somewhere across its vent
opening and steps onto the adjacent edge tile; a unit that reaches an edge tile at
its exhaust opening passes out through the casing.

- **Left vent** — the left casing, aligned to rows `r = 16..19` (four tiles). The
  surge appears here moving right, onto tiles `(0, 16)` through `(0, 19)`.
- **Top vent** — the top casing, aligned to columns `c = 22..29` (eight tiles). The
  surge appears moving down, onto tiles `(22, 0)` through `(29, 0)`.
- **Right exhaust** — the right casing, aligned to rows `r = 16..19` (four tiles). A
  unit leaving through here leaks the surge (see `specs/flow.md`).
- **Bottom exhaust** — the bottom casing, aligned to columns `c = 22..29` (eight
  tiles).

Each vent has a fixed opposite exhaust target: surge entering from the left vent
must leave through the right exhaust, and surge entering from the top vent must
leave through the bottom exhaust. The surge never chooses the nearer exhaust. This
forces each stream to cross the floor and gives the player room to build a maze
that matters. These four openings are fixed for the whole game; only their visual
state (idle vs. surge passing through) changes.

Vents glow cool blue (`#5f9bd6`); exhausts are hazard-striped and read as dangerous
(`#ff5a3c`). The casing is unbroken metal except at these four openings.

## Tower Construction and Mazing

There is no fixed path. The surge pathfinds across the open floor, and
every tower is *also* a wall: building one blocks its 2 x 2 footprint, so you
lengthen the surge's route by building structures it must walk around. This is
the core of the game — you build the maze.

- A tower may be built only where its full **2 x 2 footprint** is open. No tile
  in that footprint may be already occupied by another tower or currently occupied
  by a surge unit; the casing wall is off-grid and can never be built on. The
  placement preview snaps the cursor to the nearest valid interior grid
  intersection and shows the four tiles surrounding that intersection.
- **The openings are ordinary floor you may build against.** A tower may be
  placed **right next to a vent or exhaust**, and its footprint may even cover
  **some** of an opening's edge tiles — the opening tiles are ordinary Open
  floor, not off-limits. The only thing forbidden is *fully* sealing an opening:
  a placement that would leave an opening with **no** passable edge tile (or
  otherwise disconnect it) is rejected by the never-seal rule below. The surge
  spawns only on an opening's tiles that are still open floor and can reach the
  exhaust — never inside a tower footprint.
- **You can never seal the floor.** A placement is rejected if, after it would
  be placed, either vent would have no path to its **opposite exhaust**, or if
  it would trap a surge unit already on the floor with no remaining route to
  that unit's assigned exhaust. The build UI must show a blocked placement as
  invalid (`#ff4d4d`) and refuse it, rather than letting the player wall the
  surge in. There must always be at least one open route from the left vent to
  the right exhaust and from the top vent to the bottom exhaust — but a route
  through **any one** of an opening's tiles is enough; the player may wall off
  the rest.
- Selling a tower (see `specs/towers.md`) reopens all four tiles in its
  footprint immediately and the surge re-paths.

## Surge Movement

The surge walks the **shortest available route** from its vent to that
vent's fixed opposite exhaust:

- Movement is on the tile grid between tile centers. A unit may step to an
  orthogonally or diagonally adjacent open tile, but a diagonal step is
  allowed only when **both** orthogonally-adjacent tiles it cuts past are also
  open — the surge never squeezes through the corner gap between two
  diagonally-touching towers.
- A unit spawned from the **left vent** always pathfinds to the **right
  exhaust**. A unit spawned from the **top vent** always pathfinds to the
  **bottom exhaust**. Path distance still determines the route it takes, but not
  which exhaust it is trying to reach.
- The path is **recomputed live** whenever the floor changes — a tower built or
  sold re-routes every unit currently walking, smoothly redirecting it from
  where it stands (no teleporting or snapping backwards). Units already past a
  junction follow the new shortest route from their current tile.
- **Flyers are the exception.** Flying surge units (see `specs/creeps.md`)
  ignore the maze entirely: they travel in a straight line from their vent to
  that vent's opposite exhaust, passing over towers and walls (they still enter
  and leave through the vent and exhaust openings). Any emitter can hit them if
  they are in range, but the Flak is air-only and exists for dedicated flyer
  coverage.

## Build Panel and HUD

The build panel occupies the right strip (`x` in `[986, 1280]`, full
height), drawn on the panel background (`#1b1f26`) and separated from the reactor
by a divider (`#2c323c`). It is always fully visible and holds, top to bottom:

- **Status readouts** — the current money (in `#ffcf4d`), the lives
  remaining, and the wave indicator (`WAVE n / N`, plus a small progress
  read of the current wave). See `specs/flow.md` for what each means.
- **The shop** — a grid of buyable towers, one button per type (the six emitters
  plus the Forge and Sink of `specs/towers.md`), each showing the tower's icon,
  name, and cost. A type the player cannot currently afford is shown disabled.
  Selecting a shop entry arms placement (see `specs/controls.md`).
- **The selected-tower inspector** — when a placed tower is selected, this area
  shows its type and level, its current stats (range, damage or effect, fire
  rate), its live heat read (the same heat value drawn on the tower footprint,
  shown here as a labeled bar from `0%` to redline), and **Upgrade** (with its
  cost) and **Sell** (with its refund) actions. When nothing is selected it
  shows a brief hint or the next-wave preview.
- **Wave controls** — a **Send next wave** action (with its early-send bonus;
  see `specs/flow.md`) that reads **Start** in the untimed opening build phase
  before Wave 1, a game-speed toggle (`1x` / `2x`), and **Pause**.

The floor itself never shows persistent UI chrome over the play area beyond the
grid, the towers, the surge, transient range/placement indicators, and small
per-unit health bars; all panels and controls live in the build panel. The HUD's
meaning — money, lives, waves, scoring — is defined in `specs/flow.md`; this
file fixes only where it sits.
