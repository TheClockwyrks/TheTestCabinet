# Floe — The hunter

This file fixes the bear: how it travels, how it decides where to go, when it
appears, what takes it off the strait, and what happens when it reaches the
critter. Which frames it is drawn from is in `specs/assets.md`.

## What a bear is

A bear is a live pursuer on the strait, one tile across, with a center in stage
units like the critter's. It travels the same grid the critter hops across, it is
subject to the same traffic, and it hunts the tile the critter is on.

Tile distance between two tiles is the sum of the absolute differences of their
columns and their rows.

## The glide

A bear travels continuously along one grid axis at a time, never diagonally, and
it changes the axis it travels on only at a tile center.

A bear is always settled on one tile or travelling into a neighboring one.

| Reported | Meaning |
| --- | --- |
| `col`, `row` | The tile it last settled on. |
| `stepCol`, `stepRow` | The tile it is travelling into. Equal to `col`, `row` while it is settled. |

While it is between tiles it occupies both of those tiles, and every rule that
asks which tile a bear is on reads both.

Each tick a bear travels its current speed times the tick's length, along the
axis of the step it is on. When a tick's travel would carry it past the center of
the tile it is travelling into, the bear settles exactly on that center for that
tick and the travel left over is added to the next tick's travel, so no distance
is lost at a tile center. On settling it chooses its next step, and its facing is
the direction of the step it is travelling on.

Two properties follow, and both hold on every tick. A bear's step, and with it
its facing and the axis it travels on, changes only on a tick whose center is
exactly a tile center. And a tick moves a bear along one axis, so no tick changes
both its center `x` and its center `y`.

## Speed

A bear's footing is the footing of the tile it is travelling into. It is
`swimming` when that tile is on the water band and no floe covers it, and on ice
otherwise: the near shore, the ice band, the median, the far shore, and any water
tile a floe covers are all ice footing.

```
bearIceSpeed(L)  = BEAR_ICE_SPEED  * BEAR_SPEED_STEP ^ (L - 1)
bearSwimSpeed(L) = BEAR_SWIM_SPEED * BEAR_SPEED_STEP ^ (L - 1)
```

`BEAR_ICE_SPEED` is `3` tiles per second, `BEAR_SWIM_SPEED` is `2` tiles per
second, and `BEAR_SPEED_STEP` is `1.06`, so a bear travels about six percent
faster each level.

## Which tiles a bear may enter

A tile is **closed** to a bear when any of the following holds. A step into a
closed tile is refused: the bear stays settled where it is, on the strait and
unharmed, and chooses again on the next tick.

| Closed when the tile |
| --- |
| Is outside the grid: `inBounds(col, row)` is false. |
| Is on row `0` or row `1`, the far shore. |
| Is covered by a vehicle, as `specs/ice.md` fixes covering. |

A tile is **open** to a bear when it is not closed and no vehicle of its lane
will cover it within `BEAR_AVOID_LEAD` (`0.35` s), carrying that lane forward at
its current speed and direction.

## Hunting and routing

A bear's target is the tile the critter is on, read afresh every tick.

On settling on a tile, a bear commits to one step along the four grid directions:

1. The first step of a shortest route from its tile to its target made only of
   tiles open to it, choosing the step that most shortens that route.
2. Where no such route exists, the step into whichever open neighboring tile is
   least far from the target in tile distance.
3. Where no neighboring tile is open, no step: the bear holds the tile it is on
   and chooses again on the next tick.

Where two or more steps tie under the first clause or under the second, which of
them the bear takes is yours to choose.

## Emerging

The hunt has slots. A level below `SECOND_BEAR_LEVEL` (`5`) has one slot, and a
level from `SECOND_BEAR_LEVEL` up has `MAX_BEARS` (`2`), so at most two bears
ever hunt at once.

A slot falls empty when a crossing begins and when the bear filling it leaves the
strait. An empty slot fills the moment both of its conditions hold, and a bear
appears settled on the near shore in the critter's column, facing `up`.

| Slot | Rows the critter must have advanced | Seconds since the slot fell empty |
| --- | --- | --- |
| First | `BEAR_EMERGE_ADVANCE` (`3`) | `BEAR_EMERGE_DELAY` (`0.6`) |
| Second | `BEAR_EMERGE_ADVANCE + BEAR_SECOND_ADVANCE` (`6`) | `BEAR_EMERGE_DELAY + BEAR_SECOND_DELAY` (`2.0`) |

`BEAR_SECOND_ADVANCE` is `3` and `BEAR_SECOND_DELAY` is `1.4`. The rows the
critter has advanced this crossing is `ROW_NEAR - bestRow`, which
`specs/hopping.md` fixes, so a critter that has stayed on the near shore has
advanced none.

## Leaving the strait

A bear leaves the strait, and its slot falls empty, on each of these:

| Event | What happens |
| --- | --- |
| Traffic arrives on it | A vehicle in a lane whose speed is above `0` covers either of the two tiles the bear occupies, and that bear leaves. |
| A crossing ends | The critter loses a life, or a crossing ends in a bay, and every bear on the strait leaves. |

A bear removed by traffic is replaced on the emerging conditions above, so its
slot fills again once its delay has passed.

## Catching the critter

A bear catches the critter, while the critter is in play, when the straight-line
distance between their centers, `hypot(bearX - critterX, bearY - critterY)`, is
at most `BEAR_CATCH_DIST` (`18`) stage units. This is the one distance in the
game measured in stage units rather than in tiles; the tile distance above is
what the routing reads. The critter loses a life, wherever on the strait the two
met, and `specs/progression.md` fixes what that costs. The catch's own
drawing outlasts the bear that made it, and `specs/assets.md` fixes it.
