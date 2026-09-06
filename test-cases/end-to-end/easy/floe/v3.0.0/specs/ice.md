# Floe — The ice band

This file fixes the eight lanes of sliding vehicles the critter crosses first,
and the covering rule every part of the game reads to decide what a lane item is
on top of. The rows the band occupies are in `specs/strait.md`.

## The covering rule

A lane item is a span rather than a point. Its reported `x` is its left edge and
its length `len` is in tiles, so it occupies `[x, x + TILE * len)` on its own row.

| It covers | When |
| --- | --- |
| A point `x` on its row | `x` lies in `[itemX, itemX + TILE * len)`. |
| A tile of its row | That tile's center is covered. |
| A body on its row | That body's center is covered. |

`specs/water.md` reads the same rule for a floe.

## The three vehicles

| Kind | Length | Art |
| --- | --- | --- |
| `plow` | `3` tiles | `assets/plow/` |
| `dogsled` | `2` tiles | `assets/dogsled/` |
| `car` | `2` tiles | `assets/car/` |

`ITEM_LEN` names the length in tiles of every lane item, a floe's as well as a
vehicle's.

Every tile a vehicle covers is closed to the critter: a hop onto it is refused,
as `specs/hopping.md` states.

## The eight lanes

Each row of the ice band is one lane, and `ICE_LANES` names the eight in
ascending row order. A lane carries one kind of vehicle, runs in one direction,
and runs at one speed. `dir` is `1` for a lane running rightward (increasing `x`)
and `-1` for a lane running leftward. Speed is in tiles per second at level 1,
and gap is the whole tiles of clear ice a lane leaves between consecutive
vehicles.

| Row | Kind | Length | `dir` | Speed (level 1) | Gap |
| --- | --- | --- | --- | --- | --- |
| `11` | `plow` | `3` | `-1` | `1.7` | `8` |
| `12` | `car` | `2` | `1` | `2.1` | `7` |
| `13` | `dogsled` | `2` | `-1` | `2.5` | `7` |
| `14` | `plow` | `3` | `1` | `1.6` | `8` |
| `15` | `car` | `2` | `-1` | `2.0` | `7` |
| `16` | `dogsled` | `2` | `1` | `2.3` | `7` |
| `17` | `plow` | `3` | `-1` | `1.5` | `8` |
| `18` | `car` | `2` | `1` | `1.8` | `7` |

A lane at speed `s` and direction `d` moves every one of its vehicles by
`d * s * TILE` units per second of game time.

## How a lane is populated

Every vehicle in a lane is the lane's own kind, and the lane is evenly spaced:
consecutive vehicles leave exactly the lane's gap in tiles of clear ice between
one vehicle's right edge and the next vehicle's left edge, so consecutive left
edges are `(len + gap) * TILE` units apart.

That spacing holds at every moment of play and at every level, across the
strait's edges included: a vehicle carried off one edge returns at the other so
the run of vehicle and gap continues unbroken, and a lane always carries enough
vehicles to reach both edges of the strait.

Where a lane's pattern sits along its row is drawn at random when a level is laid
out. A lane's phase is the left edge of one of its vehicles, and the rest of the
lane follows the spacing rule from it. The eight phases are drawn uniformly and
independently, each from one period of its own lane's spacing,
`[0, (len + gap) * TILE)`, conditioned on the band being staggered: no column of
the strait is covered by a vehicle in all eight ice rows at once.

## The per-level scaling

For a level `L` from `1` to `TOTAL_LEVELS`:

```
laneSpeed(row, L) = speed(row) * LEVEL_SPEED_STEP ^ (L - 1)
laneGap(row, L)   = gap(row) + floor((L - 1) / LEVEL_GAP_EVERY)
```

`LEVEL_SPEED_STEP` is `1.06` and `LEVEL_GAP_EVERY` is `3`, so every lane runs
about six percent faster each level and every lane's gap widens by one tile from
level `4` and by two tiles from level `7`.

## Being crushed

The critter is crushed on any tick on which a vehicle in a lane whose speed is
above `0` covers the critter's center. It loses a life, and `specs/progression.md`
fixes what that costs.

A lane held at a speed of `0` moves nothing, so a critter standing where such a
vehicle covers it is left as it stands.
