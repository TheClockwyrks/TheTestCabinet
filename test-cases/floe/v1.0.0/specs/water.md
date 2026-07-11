# The Water Band — Floes

## Overview

This file defines the **water band** (rows 2–9, `specs/playfield.md`): **eight**
lanes
of deadly sea crossed only by riding drifting **floes**, and how the critter reaches
the far-shore bays. It uses the grid and palette from `specs/overview.md`. The bear
swims this band too (`specs/hunter.md`). Each lane's floe, direction, speed, size,
and spacing are **fixed** and given explicitly in the *Lane table* below;
implement them exactly as written.

The water band is the **riskier** of the two crossing zones: its floes move **faster**
and in a **wider speed range** (with a higher top speed) than the ice band's vehicles
(`specs/hazards.md`), so crossing the water demands sharper timing than crossing
the
road.

## Deadly water

Every tile of the water band is deep, freezing sea. **Standing on a water tile
with no
floe under the critter is death** — the critter falls in and **loses a life**
(`specs/flow.md`). The critter crosses only by hopping onto floes and riding them.

## Drifting floes

Each of the eight water rows is a **lane** carrying drifting **floes**, rendered
from
the provided sprites (`specs/assets.md`):

- Each lane has a fixed **direction** and **speed**, both given in the *Lane
  table*. The directions **alternate** lane to lane, and the speeds vary across the
  water's **wide** range so some lanes crawl and some race.
- **Floes come in a mix of lengths**, fixed per lane by the table, so some floes
  demand a precise landing and some are more forgiving, with real gaps of open
  water between them:
  - a **small floe** — one tile — the pan sprite (`assets/pan/`);
  - a **long raft** — a **solid** three-tile or four-tile floe, drawn as one
    continuous piece from the raft sprites (`assets/raft/`: frame 0 is the three-tile
    floe, frame 1 the four-tile floe), **not** several small pans butted together.
  A wide floe reads as one solid raft, using the raft sprite — do not tile the
  small pan across a long floe.
- **Spawn model.** Within a lane every floe is identical, and they are **evenly
  spaced**: consecutive floes are separated by the lane's **gap** (a whole number
  of tiles of open water, from the table). They drift straight along their lane and
  respawn at the far edge, like the vehicles, so each lane stays uniformly
  populated. Stagger the lanes' phases so the floes do not line up into columns.

## Riding and drifting

- When the critter is standing **on a floe** (any tile of it), it is **carried with
  the floe**: each step, the critter drifts sideways at the floe's speed and
  direction, exactly as if it were part of the floe. Its grid position moves
  with the
  ice under it.
- A **hop** is always **one absolute tile** in the pressed direction
  (`specs/controls.md`) — the drift and the hop are separate: between hops the floe
  carries the critter, and a hop moves it one tile relative to the strait. To make
  progress the critter hops from floe to floe, timing the gaps.
- **Off-edge death.** If the floe carries the critter to the side edge and would
  sweep
  it **off the strait** (past the left or right edge), the critter is lost and **loses
  a life**. You must hop off a floe before it drifts you off the edge — riding
  one to
  the edge is fatal. (Faster floes reach the edge sooner, so the fast lanes punish
  lingering.)
- Hopping onto **open water** (a tile with no floe) is death (above); hopping onto
  another floe, or back onto the median shelf (row 10) or into a bay, is safe.

## Reaching the bays

The top water lane is **row 2**, just below the far shore (rows 0–1,
`specs/playfield.md`). From a floe in row 2 the critter hops **up into an open
bay** in
row 1 to complete the crossing:

- Landing in an **open** bay fills it, scores, and starts a fresh crossing from
  the
  near shore (`specs/flow.md`, `specs/playfield.md`).
- A hop up that would land on a **filled** bay or on the **solid shore** between
  bays
  is **refused** — the critter does not move (there is no footing there and no falling
  to death from a refused hop; it simply cannot go there). Line up under an open
  bay
  and hop in.

## Lane table

The eight water lanes, top (row 2, just below the far shore) to bottom (row 9).
**Direction** `left` means the floes enter from the right edge and drift left;
`right` means they enter from the left edge and drift right. **Speed** is in
tiles/second at **level 1**; **Gap** is the whole-tile span of open water between
consecutive floes in that lane. Implement these exactly.

| Row | Floe | Length | Direction | Speed (L1) | Gap |
| --- | --- | --- | --- | --- | --- |
| 2 | Raft (`assets/raft/` frame 0) | 3 tiles | left | `3.3` | 3 tiles |
| 3 | Raft (`assets/raft/` frame 1) | 4 tiles | right | `3.5` | 3 tiles |
| 4 | Raft (`assets/raft/` frame 0) | 3 tiles | left | `4.2` | 3 tiles |
| 5 | Pan (`assets/pan/`) | 1 tile | right | `3.6` | 2 tiles |
| 6 | Raft (`assets/raft/` frame 1) | 4 tiles | left | `3.2` | 3 tiles |
| 7 | Raft (`assets/raft/` frame 0) | 3 tiles | right | `3.8` | 3 tiles |
| 8 | Pan (`assets/pan/`) | 1 tile | left | `3.4` | 2 tiles |
| 9 | Raft (`assets/raft/` frame 1) | 4 tiles | right | `3.0` | 3 tiles |

The lane speeds span `3.0`–`4.2` tiles/second — faster, and over a wider range,
than the road's `1.5`–`2.5` (`specs/hazards.md`).

**Per-level scaling** (`specs/flow.md`). Each level `L` (1-based):

- every lane speed is multiplied by `1.06^(L-1)` (about `+6%` per level);
- every lane gap **widens** by `⌊(L-1)/3⌋` tiles — `+1` tile from level 4, `+2`
  tiles from level 7 — so the floes thin as they speed up.

The water band is **crossable** at level 1 — forgiving floe sizes, real gaps — but
noticeably faster and riskier than the road, the speeds climbing with the level.
