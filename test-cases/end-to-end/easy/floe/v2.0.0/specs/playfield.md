# Playfield

## Overview

This file defines the geometry of the strait: the tile grid and the bands the
critter crosses (the near shore, the ice band, the median shelf, the water band,
and the far shore with its bays) plus the HUD bar's place on the stage. It uses the
coordinate system and palette from `specs/overview.md`. The hazards are in
`specs/hazards.md`, the floes and water in `specs/water.md`, the bear in
`specs/hunter.md`, and the HUD's contents in `specs/ui.md`.

## The stage: HUD bar and strait

The `1280 x 720` stage is split into two regions, stacked:

- HUD bar: `x` in `[0, 1280]`, `y` in `[0, 80]`, full width, 80 px tall. Its
  contents — the score, lives, level, and timer readouts — are defined in
  `specs/ui.md`.
- Strait: `x` in `[0, 1280]`, `y` in `[80, 720]`, full width, 640 px tall. All play
  happens here.

## The tile grid

The strait is a grid of 32 x 32 logical-pixel tiles, 40 columns x 20 rows
(1280 x 640). Column `c` (`0..39`) spans `x` in `[32c, 32c + 32]`; row `r`
(`0..19`) spans `y` in `[80 + 32r, 80 + 32r + 32]`. Row 0 is the top and row 19 is
the bottom. The critter starts at the bottom and crosses upward toward the top.

## The bands

From bottom to top, the strait is laid out in fixed bands. The ice band and the
water band are the same size, eight lanes each, and the far shore is kept thin so
the two crossing zones dominate the strait:

| Rows | Band | Footing |
| --- | --- | --- |
| 19 | Near shore | Solid ice, safe. The critter spawns here; the bear emerges here. |
| 11–18 | Ice band (8 lanes) | Solid ice you may stand on anywhere, but sliding vehicles cross it (`specs/hazards.md`). |
| 10 | Median shelf | Solid ice, safe footing (but the bear can reach it). |
| 2–9 | Water band (8 lanes) | Deep deadly water; crossable only on drifting floes (`specs/water.md`). |
| 0–1 | Far shore | Solid ice, mostly impassable wall, cut by the goal bays (below). |

- The near shore (row 19) and the median shelf (row 10) are full-width solid strips
  the critter can rest on. They are safe from the vehicles and the water, but not
  from the bear, which can reach any solid tile (`specs/hunter.md`). Only a filled
  bay is ever truly safe.
- The ice band rows are solid ice: the critter hops freely on them and may pause on
  an empty tile, but each row is a lane vehicles slide along. The critter cannot
  enter a tile a vehicle occupies, and a vehicle that slides into the critter is
  death (`specs/hazards.md`). The ice band reads as a darker, duller ice than the
  bright shores and median, so the median stands out as a clear safe strip
  (`specs/overview.md`).
- The water band rows are deadly water: standing on a water tile with no floe under
  you is death (`specs/water.md`). The critter crosses by hopping onto floes and
  riding them.

## The far shore and the goal bays

The far shore (rows 0–1) is solid ice the critter cannot stand on except at the
goal bays: 5 bays, each a 2-tile-wide opening in the shore along row 1, centered
near columns 4, 12, 20, 28, and 36, with solid impassable shore between them (and
the solid cap of row 0 behind them).

- The critter reaches a bay by hopping up from the top water lane (row 2) into an
  open bay tile in row 1. Landing in an open bay fills it, scores, and starts a
  fresh crossing (`specs/gameplay.md`).
- A filled bay is occupied (show the critter resting in it) and cannot be entered
  again; the solid shore between bays cannot be entered at all. A hop that would
  land the critter on a filled bay or on solid shore is refused (the critter does
  not move there), so the only way onto the far shore is into an open bay.
- Filling all 5 bays clears the level (`specs/gameplay.md`).

The contents of the HUD bar — the score, lives, level, timer, and bay markers — are
defined in `specs/ui.md`.
