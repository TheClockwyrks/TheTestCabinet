# Fathom — The trench: maze, den, tunnel, plankton, and HUD

This file defines the geometry of the trench and the things in it. All positions
and sizes are in the logical-pixel coordinate system and the 32 px tile grid
defined in `specs/overview.md` (36 columns x 18 rows, top-left tile corner at
`(64, 80)`).

## The maze

Each tile is either wall (solid rock the forager and predators cannot enter) or
open (flooded corridor). You design the maze layout; it is not fixed. A conforming
maze satisfies all of the following:

- Corridors are one tile wide. Open tiles form winding one-tile-wide corridors and
  junctions. Do not leave areas wider than one tile (no `2 x 2` or larger open
  blocks), so the maze reads as corridors, not rooms. The den (below) is the only
  exception.
- Mirror symmetry. The layout is symmetric left-to-right about the vertical
  centerline (between columns 17 and 18), so neither side is favored.
- Fully connected, with nothing sealed off. The open tiles form one single
  connected region: every open tile is reachable from every other open tile, with no
  sealed-off pockets. The forager's start tile, the den interior (reached through
  its gate), both mouths of the wrap tunnel, and every plankton tile all lie in that
  one region and are mutually reachable. No tile the game depends on may be walled
  into a pocket. A maze that strands the player, a predator, or any plankton is
  invalid.
- No dead ends; corridors loop. Every open corridor tile connects onward to at
  least two other open tiles (counting the far mouth of the wrap tunnel as one such
  connection), so the forager can always pass through a tile and come back around
  another way, and is never forced into a one-exit pocket it must reverse out of.
  Equivalently, the maze has no dead-end tiles (an open tile with only one open
  orthogonal neighbor). Favor plenty of junctions and alternate routes, matching the
  loop density of `reference/gameplay.png`, so chases stay tense and the player is
  never cornered in a stub. The den chamber is exempt: it is the one open area wider
  than a corridor, entered only through its gate.
- A solid border, except where the wrap tunnel pierces the left and right edges
  (below).
- Dense enough to matter: a substantial maze of corridors filling most of the grid,
  comparable in density to the example in `reference/gameplay.png`, not a sparse few
  paths. Concretely, corridor tiles must cover **at least 40%** of the interior (the
  grid excluding its solid border); the reference board is about 53%.

Two computable proportions keep the whole board reading like the corridors of
`reference/gameplay.png` rather than a grid of rooms. Compute both over the corridor
tiles (the open floor tiles the forager can enter, excluding the den and its gate),
where a tile's open neighbors are the orthogonally adjacent corridor tiles (the far
mouth of the wrap tunnel counts as the neighbor across that edge). Each has a **hard
range a conforming board must fall inside** (the "aim for" targets sit comfortably
within it, and the reference board lands squarely there):

- Openness: the mean number of open neighbors per corridor tile. A single winding
  corridor is `2.0`; junctions push it above `2`; open rooms push it toward `4`. Aim
  for roughly `2.1` to `2.5`; a board is **invalid above `2.8`** (rooms or a grid, not
  corridors). The reference board is about `2.16`.
- Corridor length ("mazing"): a corridor run is a maximal chain of corridor tiles
  that each have exactly two open neighbors (the straightaways and bends between one
  junction and the next); this metric is the mean run length in tiles. A grid with a
  junction at almost every tile is about `1`. Aim for roughly `3` to `5`; a board is
  **invalid below `2`** (too grid-like — junctions so dense the forager never commits
  to a corridor) or **above `8`** (too sparse — long hallways, few choices). The
  reference board is about `3.8`.

A good board keeps openness low and corridor length high at once: a grid fails the
second, a board of rooms fails the first. These bounds are not only cosmetic — a
dense, one-tile-wide, non-room board necessarily runs some corridors close enough to
each other, separated by rock, that one is hidden from another behind a wall (a blind
corner). That wall occlusion is exactly what the dark trench's sensing turns on: your
light and line of sight are stopped by rock and do not bend around it
(`specs/sensing.md`), so a board that satisfied these proportions will always contain
the geometry that makes that rule observable.

Draw the maze from the provided trench tileset (`assets/trench-walls/`, see
`specs/assets.md`): the corridor floor under every open tile, and the wall autotile
for every wall tile, picking each wall's frame from its wall-neighbors (the N/E/S/W
connection bitmask in `specs/assets.md`) so corridors get rounded rock faces and
walls merge seamlessly. Unrevealed tiles use the fog tile (see `specs/sensing.md`).

The forager starts each life at a fixed open tile you choose in the lower half of
the maze, on the centerline (so it is symmetric). The predators start in the den.

## The den

A central den holds the predators between releases. It is a small open chamber
around the grid center (around columns 15-20, rows 7-9) enclosed by wall except for
a single gate tile on its top edge (drawn from the den-gate tile, `specs/assets.md`)
through which predators exit and re-enter. The gate is passable only by predators
leaving or returning to the den; the forager cannot enter the den. No plankton sit
inside the den. The den's release schedule and the predators' use of it are defined
in `specs/predators.md`.

## The wrap tunnel

One horizontal wrap tunnel pierces the left and right border at a chosen mid-height
row clear of the den (for example row 12). The corridor at the left edge of that row
and the corridor at the right edge are joined through the wrap: a character (forager
or predator) that exits the left edge there re-enters at the right edge of the same
row, and vice versa, so the two ends are the same corridor. The interior path
between the two edges follows the rest of the maze and need not be a single straight
open row. Movement and speed are continuous through the wrap; nothing stops at the
edge. The wrap is symmetric, so it preserves the left-right mirror.

## Plankton

- Every open tile that is not in the den and not one of the wrap-tunnel edge tiles
  holds one plankton: a small glowing mote (a filled dot about 6 px across) centered
  in its tile.
- Eating a plankton (the forager's center entering its tile) removes it, scores
  points (see `specs/progression.md`), and brightens the forager (see Brightness in
  `specs/sensing.md`).
- Clearing every plankton in the maze completes the trench and descends to the next,
  deeper trench (see `specs/progression.md`).

## The bonus drifters

Bonus drifters are glowing amber motes worth a burst of points that appear over time
and wander the corridors:

- They spawn at the den gate at a fixed cadence (for example, once about every
  `25 s` while plankton remain) and drift slowly at about `64 px/s`, half the
  forager's speed, along the corridors, choosing a new direction at each junction. A
  wandering Lanternjaw copies this drift exactly, at the same `64 px/s` speed and
  with the same wander, so an undetected Lanternjaw's bulb does not merely look like
  a drifter, it moves like one (see `specs/predators.md`).
- A drifter is permanent once it spawns. It does not time out, fade, or leave
  through the tunnel; it keeps wandering until the forager eats it. Losing a life or
  clearing the trench (which reset the board) are the only other ways it leaves. So
  an amber glimmer you spot in the dark stays out there to be caught.
- Up to two drifters exist at once. The spawn cadence tops the trench up to two
  drifters and never more; when you eat one, another can spawn after the next
  interval. Two roaming amber motes, plus the Lanternjaw's identical bulb, make it
  genuinely hard to keep track of which glimmer is bait and which is jaws.
- Eating one scores the bonus (see `specs/progression.md`).
- They are drawn as always-visible amber lights, subject to each dive's rules. A
  drifter is never hidden by the dark the way a predator's body is: it is a single
  glowing amber point (`specs/sensing.md`) drawn to look almost identical to the
  Lanternjaw's always-visible bulb-light (`specs/predators.md`). At a brief glance
  you cannot tell a harmless drifter from a lurking Lanternjaw, so chasing an amber
  glimmer for points is always a gamble. Draw each in code as a soft amber mote with
  a bright core (the amber palette color `#ffd166`), matching the Lanternjaw's bulb.
  Like the Lanternjaw, a drifter is an amber-light entity: a sonar pulse does not
  reveal it. A ping leaves the amber mote unchanged and never draws its jellyfish
  body, so you can never tell a drifter from a Lanternjaw by pinging
  (`specs/sensing.md`). Its jellyfish body appears only up close, where your light
  (or a flare) falls on it (`specs/assets.md`). How far you can see them depends on
  the dive: the rule for the dive you are building is in `specs/sensing.md`.

## HUD

The HUD occupies the strips above and below the maze region (see the coordinate
system in `specs/overview.md`); it is always fully lit and never fogged.

- Top strip (`y` in `[0, 80]`): the current score in large monospace digits (about
  `48 px` tall) toward the left, and a small dim mode label (the dive name) in the
  top-right corner.
- Bottom strip (`y` in `[656, 720]`): the remaining lives shown as small forager
  icons toward the left; the current depth (for example `DEPTH 1`) toward the right;
  and, between them, the sonar and ink readiness indicators, small gauges that fill
  back up as each ability comes off cooldown (see `specs/sensing.md` and
  `specs/movement.md`), so the player can see at a glance when each is ready.
