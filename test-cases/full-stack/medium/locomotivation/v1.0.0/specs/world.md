# Locomotivation — the yard

This file defines the tiled world every level is built from: the grid and
coordinate system, the ¾ draw order, the tile kinds, and the placeable elements
(spawn, dispensers, drop zones, buildings, levers). The per-level layouts are in
`specs/levels.md`; this file defines the vocabulary those layouts use.

## The tile grid

The yard viewport is 1280 x 640 (`x` in `[0, 1280]`, `y` in `[80, 720]`), tiled
with 40 x 40 logical-pixel tiles:

- 32 columns (`col` `0..31`) and 16 rows (`row` `0..15`).
- A tile `(col, row)` covers pixels `x in [col*40, col*40+40)`,
  `y in [80 + row*40, 80 + row*40 + 40)`; its center is
  `(col*40 + 20, 80 + row*40 + 20)`.
- Every level's whole layout fits this grid; the camera is fixed and never scrolls.

The worker and trains move in continuous logical-pixel space over this grid; tiles
classify the space (what is walkable, what a train runs on, what is safe), but
movement and collision are continuous, not tile-stepped.

## The ¾ draw order

Render in this order so the Stardew-style ¾ view holds together
(`specs/overview.md`):

1. The ground layer: every tile's floor (ground, ballast under tracks, bridge deck,
   refuge, gap water), drawn flat.
2. The rails: the steel rails and sleepers on top of track and bridge tiles.
3. Upright sprites: buildings, dispensers, drop-zone markers, signals, levers,
   packages, trains, and the worker, painted back-to-front by base `y` (a painter's
   sort on the sprite's footprint row), each with a small contact shadow, so a
   sprite lower on the screen occludes one above it and trains occlude what is
   behind their tall bodies.
4. Particle VFX, over the sprites (`specs/assets.md`).
5. The HUD and overlays, in screen space over everything (`specs/flow.md`).

## Tile kinds

Each tile in a level is one of the following. The look of each is a produced sprite
in the palette (`specs/assets.md`); the behavior is fixed here.

| Tile | Walkable | Train runs on it | Notes |
| --- | --- | --- | --- |
| Ground | yes | no | Safe gravel/grass yard floor, the default. |
| Track | yes | yes | A rail lane. Safe to stand on except when a train overlaps it, which is the whole game. Belongs to a numbered track (`specs/trains.md`) with an orientation (horizontal or vertical). |
| Bridge | yes | yes | A track tile that is the only crossing over a gap: the tiles beside it are gap (impassable), so crossing the bridge means committing to the track for its length. Same lethal-on-overlap rule as track. |
| Refuge | yes | no | A safe pocket, a tile a train never enters, set beside or between tracks and along bridges, where the worker can wait out a train. The gap tile between two adjacent parallel tracks is implicitly a refuge (no train reaches it); an explicit refuge bay is a wider, clearly-marked safe pocket. |
| Wall | no | no | Impassable scenery: building footprints, sheds, fences, stacked containers. Blocks the worker and bounds the level. |
| Gap | no | no | Impassable void or water beside bridges. The worker cannot enter it. |

Rules:

- The worker may occupy any Ground, Track, Bridge, or Refuge tile. It is blocked
  from Wall and Gap tiles: collision stops it at their edge and it slides along the
  blocked edge rather than sticking.
- A track is a straight run of Track (or Bridge) tiles sharing one id and
  orientation. A corridor is one or more parallel tracks with the safe gap tiles
  between them; crossing a corridor is a hop-and-wait from safe tile to safe tile.
- Standing on a Track or Bridge tile is only dangerous while a train's body overlaps
  the worker; otherwise it is ordinary footing.

## Placeable elements

A level places these on top of its tiles (`specs/levels.md` gives each a tile
coordinate; `specs/cargo.md` and `specs/trains.md` define their behavior):

- Spawn: the single point the worker starts at and respawns at after a death. One
  per level, on a safe tile.
- Dispenser: a station of one color and weight class that emits a package; taking
  one causes a fresh one to appear (`specs/cargo.md`). A ¾ building sprite with a
  chute; its color reads clearly.
- Drop zone: a marked pad of one color that accepts only packages of that color;
  delivering there credits the shift (`specs/cargo.md`). A flat, clearly
  color-coded ground pad with a ¾ marker post.
- Unique and optional package spawns: fixed positions where a unique or optional
  package starts (`specs/cargo.md`).
- Signal: a crossing signal beside a track that telegraphs an approaching train
  (`specs/trains.md`); clear, warning, and danger states drawn in the signal
  colors.
- Lever: a junction switch the worker toggles to divert a train onto a different
  branch (`specs/trains.md`); a ¾ post with a throw handle showing its current
  setting.
- Buildings and scenery: decorative Wall footprints (yard office, sheds, container
  stacks) that bound and theme the level and read clearly in the ¾ view.

Everything a level needs, and the exact coordinates, are in `specs/levels.md`. The
exact painterly rendering of each within the palette is yours to design
(`specs/assets.md`).
