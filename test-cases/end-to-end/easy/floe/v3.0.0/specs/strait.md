# Floe — The strait

This file fixes the geometry every position in the game is measured against: how
the stage is divided, the tile grid the strait is laid out on, the map between a
tile and the stage, the five bands the critter crosses, and the five bays that
end a crossing. Every figure below carries the name this specification gives it.

## The stage, divided

The `1280 x 720` stage carries two regions, stacked.

| Region      | `x`                           | `y`                                                 | Contents                                                                            |
| ----------- | ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The HUD bar | `[0, 1280]`                   | `[0, HUD_H]` (`[0, 80]`)                            | The readouts `specs/ui.md` fixes. No critter, bear, vehicle, or floe is drawn here. |
| The strait  | `[0, STRAIT_W]` (`[0, 1280]`) | `[STRAIT_TOP, STRAIT_TOP + STRAIT_H]` (`[80, 720]`) | All play.                                                                           |

## The tile grid

The strait is a grid of square tiles, `TILE` (`32`) units on a side, `COLS`
(`40`) columns across by `ROWS` (`20`) rows down. Column `0` is the leftmost and
column `39` the rightmost; row `0` is the topmost and row `19` the bottom row the
critter starts on. A crossing runs upward, from row `19` toward row `1`.

## The tile-to-stage map

Every conversion between a tile and a stage position in this game is one of these
six, and no other form is used.

```
tileLeft(c) = 32 * c
tileTop(r)  = 80 + 32 * r
tileCX(c)   = 32 * c + 16
tileCY(r)   = 80 + 32 * r + 16
colAt(x)    = floor(x / 32)
rowAt(y)    = floor((y - 80) / 32)
```

`inBounds(c, r)` is true when `0 <= c < 40` and `0 <= r < 20`, and a tile outside
that range is not part of the strait.

## The five bands

From the bottom of the strait to the top:

| Rows      | Band                                        | What it is                                                                                                          |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `19`      | The near shore (`ROW_NEAR`)                 | Solid ice, full width. A crossing begins here, and a bear emerges here. It carries no lane.                         |
| `11`–`18` | The ice band (`ICE_TOP`–`ICE_BOTTOM`)       | Solid ice the critter may stand on anywhere, crossed by eight lanes of sliding vehicles. `specs/ice.md` fixes them. |
| `10`      | The median shelf (`ROW_MEDIAN`)             | Solid ice, full width. It carries no lane.                                                                          |
| `2`–`9`   | The water band (`WATER_TOP`–`WATER_BOTTOM`) | Deep water, crossed by eight lanes of drifting floes. `specs/water.md` fixes them.                                  |
| `1`       | The bay row (`ROW_BAYS`)                    | Solid far shore, cut by the five bays below.                                                                        |
| `0`       | The cap (`ROW_CAP`)                         | Solid far shore, full width, behind the bays.                                                                       |

The near shore and the median shelf carry no vehicle and no floe, at any level.
They are the two strips the critter can stand on indefinitely without the water
or the traffic reaching it.

A crossing begins with the critter on the near shore at column `START_COL`
(`20`).

## The five bays

The bay row is solid far shore except at five bays, each exactly two columns
wide. `BAYS` holds the pairs, left to right:

| Bay index | Columns    |
| --------- | ---------- |
| `0`       | `3`, `4`   |
| `1`       | `11`, `12` |
| `2`       | `19`, `20` |
| `3`       | `27`, `28` |
| `4`       | `35`, `36` |

`BAY_COUNT` is `5`. Every column of row `1` outside those ten is solid far shore,
and row `0` is solid across its whole width. What an open and a filled bay are,
and what happens when the critter enters one, is in `specs/bays.md`.

## Footing

The critter's footing is what it is standing on, and it takes exactly one of
three values.

| Footing | When                                                              |
| ------- | ----------------------------------------------------------------- |
| `solid` | Its row is `0`, `1`, `10`, `11`–`18`, or `19`.                    |
| `floe`  | Its row is `2`–`9` and a floe on that row covers its center `x`.  |
| `water` | Its row is `2`–`9` and no floe on that row covers its center `x`. |

`specs/water.md` fixes when a floe covers a point, and what standing on `water`
costs.
