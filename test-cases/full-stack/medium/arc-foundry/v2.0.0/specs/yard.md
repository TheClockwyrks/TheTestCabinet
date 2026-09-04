# Arc Foundry — The yard

The yard is the tile grid the Load crosses and the player builds on. This file gives the
grid, the four states a tile is in, the footprint every structure occupies, the three
maps and their exact coordinates, and the conditions a placement must satisfy. How the
Load crosses the yard, and how a wall lengthens its route, are in `specs/pathing.md`.

All positions are in the logical units of `specs/overview.md`. The yard occupies the
region `x` `0`–`1000`, `y` `56`–`720`, shown whole with no scrolling camera, so every
waypoint, the entry, the collector, and everything built on the yard are visible at once
whichever map is in play.

## The tile grid

The yard carries a grid of `GRID_COLS` (`50`) columns by `GRID_ROWS` (`33`) rows of
`TILE` (`20`) square tiles, anchored at the yard region's top-left corner `(0, 56)`.
Columns are `c` `0`–`49` and rows are `r` `0`–`32`. The `4`-unit strip at `y` `716`–`720`
is frame rather than playable grid.

| Quantity | Formula |
| --- | --- |
| Tile `(c, r)` horizontal extent | `x` from `20c` to `20c + 20` |
| Tile `(c, r)` vertical extent | `y` from `56 + 20r` to `56 + 20r + 20` |
| Tile `(c, r)` center | `(20c + 10, 56 + 20r + 10)` |

A faint grid is drawn over the yard at all times so the tiles read. The Load walks
between tile centers.

## Tile states

Every tile is in exactly one of four states.

| State | Crossed by the Load | Buildable | Set by |
| --- | --- | --- | --- |
| Open | Yes | Yes, subject to placement legality below | The yard's resting state |
| Blocked | No | No | A structure's footprint covering it |
| Fixed-blocked | No | No | A map's pre-placed housing |
| Waypoint | Yes | No | A waypoint platform covering it |

A Blocked tile becomes Open again only when the structure covering it is dismantled.
Fixed-blocked and Waypoint tiles never change state.

## The structure footprint

Every structure occupies a uniform footprint of `FOOTPRINT` (`2`) by `FOOTPRINT` tiles,
`40` by `40` units, anchored by its top-left tile `(col, row)` and covering tiles `col`
through `col + 1` by `row` through `row + 1`. Legal anchors are `col` `0`–`48` and `row`
`0`–`31`.

- A structure's center, used for range, targeting, and drawing, is
  `(20 * (col + 1), 56 + 20 * (row + 1))`.
- The footprint is the same at every quality tier and for every kind of structure: a
  candidate, a component, a blocker, and a combination tower all occupy `2` by `2`.
- The non-firing Regulator occupies and walls its footprint like every other structure.

## Waypoint platforms

Each map's chain runs through waypoints, and a waypoint is a four-tile platform rather
than a bare tile, so it can never be walled off. A platform anchored at `(c, r)` covers:

| Tile | Which |
| --- | --- |
| `(c - 1, r)` | The left arm |
| `(c, r)` | The anchor, and the tile the Load paths to |
| `(c + 1, r)` | The right arm |
| `(c, r + 1)` when `r < 16`, otherwise `(c, r - 1)` | The stem, pointing toward the grid's vertical center |

All four are Waypoint tiles: the Load crosses them freely and no footprint may cover any
of them. The entry and the collector are single edge tiles rather than platforms.

The platform's four tiles are the whole of the restriction. Every Open tile that merely
touches a platform, beyond either arm, above or below the platform's row, alongside the
stem, or diagonally at a corner, is buildable like any other tile, subject only to the
placement conditions below.

Every waypoint anchor sits at least `4` tiles inside every yard edge, in `col` `4`–`45`
and `row` `4`–`28`, so a `2` by `2` footprint fits between a platform's arm and the yard
edge with a one-tile lane still open beside it.

## Placement legality

A footprint anchored at `(col, row)` may take a placement when all of the following hold.

| Condition | Requirement |
| --- | --- |
| In bounds | `col` is `0`–`48` and `row` is `0`–`31`. |
| Tiles free | All four tiles are Open, or all four are covered by a single blocker and none other. |
| No unit standing on it | No ground unit of the Load currently occupies any of the four tiles. A flying unit passes over the yard, so it never blocks a placement. |
| Route preserved | The never-seal rule of `specs/pathing.md` holds after the placement. |

Dropping a rock onto the footprint of an existing blocker is the one placement that lands
on tiles that are not Open. It rerolls that blocker in place, as `specs/scrap-press.md`
states.

A placement that fails any condition is refused: nothing is placed, no stamp is spent,
and the held rock stays held.

## The maps

Arc Foundry ships three maps, held in `MAPS` and chosen before a run begins. Every map
plays the same campaign, economy, roster, and scaling; the topology is what differs. Each
map's chain runs six waypoints, `WP1` through `WP6`, between the entry and the collector.

Coordinates are tile `(col, row)`. Each `WP` coordinate is the anchor of a four-tile
platform as defined above. The entry and the collector each sit on a yard edge.

### Map A, The Substation

A perimeter serpentine: the route runs the top edge, down the right side, back along the
bottom, up the left, then folds inward across the middle and drops before breaking out to
the right.

| Checkpoint | Tile | Edge |
| --- | --- | --- |
| Entry | `(0, 5)` | Left |
| WP1 | `(44, 5)` | — |
| WP2 | `(44, 27)` | — |
| WP3 | `(5, 27)` | — |
| WP4 | `(5, 14)` | — |
| WP5 | `(36, 14)` | — |
| WP6 | `(36, 20)` | — |
| Collector | `(49, 20)` | Right |

The Substation carries no fixed housings.

### Map B, The Switchyard

A crossing star whose legs cut diagonally through the center: from the top the route
whips down to the bottom-left, up to the top-right, across to the top-left, down to the
bottom-right, into the center, out to the left, and finally down to the collector.

| Checkpoint | Tile | Edge |
| --- | --- | --- |
| Entry | `(25, 0)` | Top |
| WP1 | `(5, 26)` | — |
| WP2 | `(44, 6)` | — |
| WP3 | `(5, 6)` | — |
| WP4 | `(44, 26)` | — |
| WP5 | `(24, 16)` | — |
| WP6 | `(5, 16)` | — |
| Collector | `(25, 32)` | Bottom |

The Switchyard carries no fixed housings.

### Map C, The Transformer Yard

Two large fixed transformer housings split the yard on a diagonal, and the central `WP2`
threads the gap between them.

| Checkpoint | Tile | Edge |
| --- | --- | --- |
| Entry | `(0, 2)` | Left |
| WP1 | `(44, 5)` | — |
| WP2 | `(24, 16)` | — |
| WP3 | `(44, 28)` | — |
| WP4 | `(24, 28)` | — |
| WP5 | `(6, 28)` | — |
| WP6 | `(6, 16)` | — |
| Collector | `(0, 30)` | Left |

Its two housings are Fixed-blocked tiles, drawn as steel transformer boxes that read as
impassable:

| Housing | Tiles |
| --- | --- |
| 1 | `col` `12`–`19` by `row` `6`–`12` |
| 2 | `col` `30`–`37` by `row` `20`–`26` |

The chain `Entry → WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → Collector` has an open route
around both housings on an otherwise empty yard.

## The entry and the collector

Every map draws its entry as a blown feeder vent the Load spills from, and its collector
as a grounding sink the Load grounds out at. A unit that reaches the collector leaks, as
`specs/economy.md` states. Both sit on the single tile the map's table gives them.
