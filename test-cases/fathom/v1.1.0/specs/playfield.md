# Fathom — The trench: maze, den, tunnels, plankton, and HUD

This file defines the geometry of the trench and the things in it. All positions
and sizes are in the logical-pixel coordinate system and the **32 px tile grid**
defined in `specs/overview.md` (36 columns x 18 rows, top-left tile corner at
`(64, 80)`).

## The maze

Each tile is either **wall** (solid rock; the forager and predators cannot enter
it) or **open** (flooded corridor). You design the maze layout; it is not fixed.
A conforming maze must satisfy all of the following:

- **Corridors are one tile wide.** Open tiles form winding one-tile-wide
  corridors and junctions. Do not leave areas wider than one tile (no `2 x 2`
  or larger open blocks), so the maze reads as corridors, not rooms. The den
  (below) is the only exception.
- **Mirror symmetry.** The layout is symmetric left-to-right about the vertical
  centerline (between columns 17 and 18), so neither side is favored.
- **Fully connected — nothing sealed off.** The open tiles form **one single
  connected region**: every open tile is reachable from every other open tile,
  with no sealed-off pockets. In particular the forager's start tile, the den
  interior (reached through its gate), both mouths of every wrap tunnel, and
  **every** plankton tile must all lie in that one region and be mutually
  reachable. No tile the game depends on — the forager's spawn, a predator's path
  out of the den, or any plankton — may be walled into a pocket. A maze that
  strands the player, a predator, or any plankton is invalid.
- **No dead ends — corridors loop.** Like a classic maze-chase board, the
  corridors form a richly looped network, not a branching tree of stubs. **Every
  open corridor tile connects onward to at least two other open tiles** (counting
  the far mouth of a wrap tunnel as one such connection), so the forager can
  always pass through a tile and come back around another way and is never forced
  into a one-exit pocket it must reverse out of. Equivalently: the maze has **no
  dead-end tiles** (an open tile with only one open orthogonal neighbor). Favor
  plenty of junctions and alternate routes — match the loop density of
  `reference/gameplay.png` — so chases stay tense and the player is never cornered
  in a stub. (The den chamber is exempt: it is the one open area wider than a
  corridor, entered only through its gate.)
- **A solid border**, except where the wrap tunnels pierce the left and right
  edges (below).
- **Dense enough to matter:** a substantial maze of corridors filling most of the
  grid, comparable in density to the example in `reference/gameplay.png` — not a
  sparse few paths.

Draw the maze from the provided **trench tileset** (`assets/trench-walls/`, see
`specs/assets.md`): the corridor **floor** under every open tile, and the **wall
autotile** for every wall tile, picking each wall's frame from its wall-neighbors
(the N/E/S/W connection bitmask in `specs/assets.md`) so corridors get rounded
rock faces and walls merge seamlessly. Unrevealed tiles use the **fog** tile (see
`specs/sensing.md`).

The forager starts each life at a fixed open tile you choose in the lower half of
the maze, on the centerline (so it is symmetric). The predators start in the den.

## The den

A central **den** holds the predators between releases. It is a small open
chamber around the grid center (around columns 15-20, rows 7-9) enclosed by wall
except for a single **gate** tile on its top edge (drawn from the **den-gate**
tile, `specs/assets.md`) through which predators exit and re-enter. The gate is
passable only by predators leaving or returning to the den; the forager cannot
enter the den. No plankton sit inside the den. The den's
release schedule and the predators' use of it are defined in `specs/predators.md`.

## Wrap tunnels

There is **one horizontal wrap tunnel** that pierces the left and right border at
a chosen mid-height row clear of the den (for example row 12). The corridor at the
left edge of that row and the corridor at the right edge are joined through the
wrap: a character (forager or predator) that exits the left edge there re-enters
at the right edge of the same row, and vice versa — the two ends are the same
corridor. The interior path between the two edges follows the rest of the maze and
need not be a single straight open row. Movement and speed are continuous through
the wrap; nothing stops at the edge. The wrap is symmetric, so it preserves the
left-right mirror.

## Plankton

- Every open tile that is **not** in the den and **not** the wrap-tunnel edge
  tiles holds one **plankton**: a small glowing mote (a filled dot about 6 px
  across) centered in its tile.
- Eating a plankton (the forager's center entering its tile) removes it, scores
  points (see `specs/flow.md`), and brightens the forager (see Brightness in
  `specs/sensing.md`).
- Clearing **every** plankton in the maze completes the trench and descends to the
  next, deeper trench (see `specs/flow.md`).

## The bonus drifter

Periodically a **bonus drifter** — a glowing jelly worth a burst of points —
appears and wanders the corridors:

- It spawns at the den gate at a fixed cadence (for example, once about every
  `25 s` while plankton remain) and drifts slowly (about `64 px/s`, half the
  forager's speed) along the corridors, choosing a new direction at each junction,
  for about `12 s` before leaving through a wrap tunnel or fading out.
- Eating it scores the bonus (see `specs/flow.md`). At most one drifter exists at
  a time.
- The drifter is subject to the same fog of war as everything else: it is only
  visible where your light, a sonar pulse, or a flare reveals it. It carries a
  faint glow of its own, the same way the predators do (see `specs/sensing.md`).

## HUD

The HUD occupies the strips above and below the maze region (see the coordinate
system in `specs/overview.md`); it is always fully lit and never fogged.

- **Top strip** (`y` in `[0, 80]`): the current **score** in large monospace
  digits (about `48 px` tall) toward the left, and a small dim **mode label**
  (e.g. `TRENCH`) in the top-right corner.
- **Bottom strip** (`y` in `[656, 720]`): the **remaining lives** shown as small
  forager icons toward the left; the current **depth / level** (e.g. `DEPTH 1`)
  toward the right; and, between them, the **sonar** and **ink** readiness
  indicators — small gauges that fill back up as each ability comes off cooldown
  (see `specs/sensing.md` and `specs/movement.md`), so the player can see at a
  glance when each is ready.
