# Floe — The water band

This file fixes the eight lanes of drifting floes the critter crosses second, and
what the water between them does. The rows the band occupies are in
`specs/strait.md`, and the covering rule a floe is read by is in `specs/ice.md`.

## The three floes

| Kind    | Length    | Art                       |
| ------- | --------- | ------------------------- |
| `pan`   | `1` tile  | `assets/pan/`             |
| `raft3` | `3` tiles | `assets/raft/`, frame `0` |
| `raft4` | `4` tiles | `assets/raft/`, frame `1` |

A floe is one continuous platform. Every tile it covers is footing, so a raft's
whole span carries the critter.

## The eight lanes

Each row of the water band is one lane, and `WATER_LANES` names the eight in
ascending row order. A lane carries one kind of floe, drifts in one direction,
and drifts at one speed. `dir` is `1` for a lane drifting rightward (increasing
`x`) and `-1` for a lane drifting leftward. Speed is in tiles per second at level
1, and gap is the whole tiles of open water a lane leaves between consecutive
floes.

| Row | Kind    | Length | `dir` | Speed (level 1) | Gap |
| --- | ------- | ------ | ----- | --------------- | --- |
| `2` | `raft3` | `3`    | `-1`  | `3.3`           | `3` |
| `3` | `raft4` | `4`    | `1`   | `3.5`           | `3` |
| `4` | `raft3` | `3`    | `-1`  | `4.2`           | `3` |
| `5` | `pan`   | `1`    | `1`   | `3.6`           | `2` |
| `6` | `raft4` | `4`    | `-1`  | `3.2`           | `3` |
| `7` | `raft3` | `3`    | `1`   | `3.8`           | `3` |
| `8` | `pan`   | `1`    | `-1`  | `3.4`           | `2` |
| `9` | `raft4` | `4`    | `1`   | `3.0`           | `3` |

A lane at speed `s` and direction `d` moves every one of its floes by
`d * s * TILE` units per second of game time.

## How a lane is populated

Every floe in a lane is the lane's own kind, and the lane is evenly spaced:
consecutive floes leave exactly the lane's gap in tiles of open water between one
floe's right edge and the next floe's left edge, so consecutive left edges are
`(len + gap) * TILE` units apart.

That spacing holds at every moment of play and at every level, across the
strait's edges included: a floe carried off one edge returns at the other so the
run of floe and open water continues unbroken, and a lane always carries enough
floes to reach both edges of the strait.

Where a lane's pattern sits along its row when a level is laid out is drawn from
the game's own seeded randomness. The phases drawn leave the band staggered: no
column of the strait carries a floe in all eight water rows at once.

## The per-level scaling

For a level `L` from `1` to `TOTAL_LEVELS`:

```
laneSpeed(row, L) = speed(row) * LEVEL_SPEED_STEP ^ (L - 1)
laneGap(row, L)   = gap(row) + floor((L - 1) / LEVEL_GAP_EVERY)
```

`LEVEL_SPEED_STEP` is `1.06` and `LEVEL_GAP_EVERY` is `3`, the same figures the
ice band scales by.

## Deep water

Every tile of the water band is deep water. The critter's footing on a water row
is `floe` while a floe of that row covers its center and `water` otherwise, as
`specs/strait.md` states.

The critter falls in on any tick on which its footing is `water`. It loses a
life, and `specs/progression.md` fixes what that costs.

## Riding a floe

A critter whose footing is `floe` is carried by the lane it is on. Its center `x`
changes by `d * s * TILE` units per second, `d` and `s` being that lane's
direction and speed, and its column follows its center by `colAt(x)`. Its row and
its center `y` are left where they are, and a floe carries the critter across
tile boundaries without moving it between rows.

A hop taken while riding is one absolute tile of the strait, as
`specs/hopping.md` states, so the critter leaves a floe on the same terms it
leaves any other tile.

## Being swept off

A critter carried to a side edge of the strait is lost. It loses a life on the
tick its center `x` falls below `0` or rises above `STRAIT_W` (`1280`).
