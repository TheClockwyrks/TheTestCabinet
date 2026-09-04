# Meltdown — The reactor floor

This file defines the geometry every other rule is written against: the two
regions the stage is divided into, the casing wall that encloses the floor, the
tile grid inside it, the map between a tile and the stage, how a tower footprint
sits on that grid, and the four openings the surge enters and leaves through.
Every figure below carries the name this specification gives it here.

## The two regions

The `1280 x 720` stage is split into two regions, side by side.

| Region | Extent | Holds |
| --- | --- | --- |
| The reactor | `x` in `[0, REACTOR_W]` (`986`), `y` in `[0, 720]` | The casing band and the floor inside it. |
| The build panel | `x` in `[PANEL_X, 1280]` (`[986, 1280]`), `PANEL_W` (`294`) wide, full height | Every readout and every control `specs/hud.md` states. |

The build panel is drawn across its whole strip for the full height of the stage.
Play is confined to the reactor region: no tower, no surge unit, and no on-floor
read is drawn in the panel's strip, and no panel readout or control is drawn on
the floor.

## The casing wall

The floor is ringed by a solid casing band `CASING` (`18`) units thick on all
four sides. Its outer edge is the reactor region's boundary and its inner edge is
the floor's, so the band spans `x` in `[0, 18]` and `[968, 986]` and `y` in
`[0, 18]` and `[702, 720]`.

The casing is impassable and is not part of the tile grid. A surge unit never
crosses it, so a unit's centre leaves the floor rectangle only through one of the
four openings below, and no tower footprint ever covers any part of it. It is
drawn unbroken except at those four openings.

## The tile grid

The floor is a grid of square tiles, `COLS` (`50`) across by `ROWS` (`36`) down,
each `TILE` (`19`) units square, filling the `FLOOR_W x FLOOR_H` (`950 x 684`)
rectangle whose top-left corner sits at `(FLOOR_X0, FLOOR_Y0)` (`(18, 18)`), just
inside the casing. Its far edge is `(FLOOR_X1, FLOOR_Y1)` (`(968, 702)`).

A tile is addressed as `(c, r)`, both zero-indexed from the floor's top-left, so
`c` grows to the right and `r` grows downward.

Each tile is in one of two states:

| State | Meaning |
| --- | --- |
| Open | Empty floor. A surge unit walks over it, and a tower footprint may cover it. |
| Blocked | Covered by part of a tower's footprint. `specs/mazing.md` states what that means for the surge. |

## The tile-to-stage map

A tile's corner and its centre on the stage:

```
tileLeft(c) = FLOOR_X0 + TILE * c
tileTop(r)  = FLOOR_Y0 + TILE * r
tileCX(c)   = FLOOR_X0 + TILE * c + TILE / 2
tileCY(r)   = FLOOR_Y0 + TILE * r + TILE / 2
```

Tile `(c, r)` therefore spans `x` in `[18 + 19c, 18 + 19c + 19]` and `y` in
`[18 + 19r, 18 + 19r + 19]`, and its centre is at
`(18 + 19c + 9.5, 18 + 19r + 9.5)`.

The inverse, which is how the tile an entity occupies is read from its centre:

```
c = floor((x - FLOOR_X0) / TILE)
r = floor((y - FLOOR_Y0) / TILE)
```

A tile lies on the grid when `inBounds(c, r)`, which is `0 <= c < COLS` and
`0 <= r < ROWS`.

## Tower footprints

A tower occupies a square footprint of `size x size` tiles, snapped to the grid
and anchored by its top-left tile `(col, row)`. It covers the tiles `col` through
`col + size - 1` by `row` through `row + size - 1`, and every one of them is
blocked while the tower stands. `specs/towers.md` gives each tower's size.

A footprint's centre, which is the point range is measured from and the point a
tower reports as its own position, is:

```
footprintCentre(col, row, size) = (
  tileLeft(col) + size * TILE / 2,
  tileTop(row)  + size * TILE / 2
)
```

## The openings

The surge enters through two vents and leaves through two exhausts, each an
opening cut into the casing near the middle of an edge and aligned to a run of
tile rows or columns. The side openings are four tiles across and the top and
bottom openings are eight, and each covers exactly the run its opposite covers,
so both vent-to-exhaust corridors run straight across the floor.

| Opening | Constant | Casing edge | Tiles it opens onto |
| --- | --- | --- | --- |
| Left vent | `LEFT_VENT_ROWS` | Left | `(0, 16)` through `(0, 19)` |
| Right exhaust | `RIGHT_EXHAUST_ROWS` | Right | `(49, 16)` through `(49, 19)` |
| Top vent | `TOP_VENT_COLS` | Top | `(22, 0)` through `(29, 0)` |
| Bottom exhaust | `BOTTOM_EXHAUST_COLS` | Bottom | `(22, 35)` through `(29, 35)` |

Both row runs are `16` through `19` inclusive and both column runs are `22`
through `29` inclusive.

An opening's tiles are ordinary floor. A surge unit walks onto them and a tower
footprint may cover them, subject to the never-seal rule in `specs/mazing.md`.

Each vent has a fixed opposite exhaust, given by `OPPOSITE`:

| Vent | Its exhaust |
| --- | --- |
| `left` | `right` |
| `top` | `bottom` |

A unit that enters at a vent is assigned that vent's opposite exhaust for its
whole life and never the nearer one, so each stream crosses the whole floor.
