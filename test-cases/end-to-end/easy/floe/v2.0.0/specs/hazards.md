# The Ice Band — Hazards

## Overview

This file defines the ice band (rows 11–18, `specs/playfield.md`): eight lanes of
solid pack ice, each with sliding vehicles the critter must dodge. It uses the grid
and palette from `specs/overview.md`. The bear navigates these hazards too, and is
reset by them (`specs/hunter.md`). Each lane's vehicle, direction, speed, and
spacing are fixed and given explicitly in the Lane table below; implement them
exactly as written.

The ice band is the gentler of the two crossing zones: its vehicles move slower and
in a narrower speed range than the water's floes, so the road is the safer half and
the water is the riskier half (`specs/water.md`).

## Lanes of sliding vehicles

Each of the eight ice-band rows is a lane. The ice itself is solid (the critter may
hop onto and pause on any ice tile), but vehicles slide across the lane
horizontally.

- Each lane has a fixed direction (left or right) and a fixed speed, both given in
  the Lane table. The directions alternate lane to lane, so the band reads as a
  legible weave of opposing traffic, and the speeds vary within the road's narrow
  range so some lanes are a little quicker and some slower.
- Spawn model. Within a lane every vehicle is identical, and they are evenly spaced:
  consecutive vehicles are separated by the lane's gap (a whole number of tiles of
  clear ice, from the table). They enter from one side edge (the left edge for a
  right-moving lane, the right edge for a left-moving lane), slide straight across,
  and leave at the far edge, respawning so each lane stays uniformly populated.
  Because the vehicles are evenly spaced and the lane moves at a fixed speed, the
  timing of the gaps is fully determined by the table. Stagger the lanes' phases so
  they do not line up into a solid vertical wall.

## Colliding with a vehicle

A vehicle is more than one tile long (below), and every tile it covers is solid and
deadly, but you die only when traffic runs into you, never by stepping into it:

- You cannot move into a vehicle. A hop that would land the critter on a tile a
  vehicle currently covers is refused, exactly like hopping into a wall: the critter
  does not move, and no life is lost (`specs/controls.md`). You can never step into
  an occupied tile.
- A vehicle that runs into you kills you. If a plow, dogsled, or car slides into the
  tile the critter is standing on, the critter is crushed and loses a life
  (`specs/gameplay.md`).

So the ice band is a puzzle of timing the gaps: the critter is safe in the clear ice
between vehicles, and safe from vehicles on the shores and median
(`specs/playfield.md`), but it must never let a vehicle catch up to the tile it is
standing on, and it is never safe from the bear.

## The three vehicles

Three kinds of vehicle populate the lanes, rendered from the provided sprites
(`specs/assets.md`). All are multi-tile vehicles: the whole sprite moves as one unit
and every tile it covers is deadly.

- The snow plow: a big, heavy machine three tiles long (`assets/plow/`). Use it for
  the slowest lanes. Draw it facing the way its lane moves (mirror the sprite for a
  left-moving lane).
- The dogsled: a fast sled-dog team two tiles long (`assets/dogsled/`). Use it for
  the quicker lanes. Mirror it for a left-moving lane.
- The car: an ordinary sedan two tiles long (`assets/car/`). Another quick vehicle;
  use it in the quicker lanes alongside the dogsled. Mirror it for a left-moving
  lane.

Give the band variety: some slow three-tile plow lanes, some quicker two-tile
dogsled and car lanes, so the eight lanes do not all read the same. A long plow
leaves a smaller gap behind it than a two-tile car or dogsled at the same spacing,
so the vehicle length is part of the timing. Mix the two-tile vehicles (car and
dogsled) so the quicker lanes are not all the same sprite.

## Lane table

The eight ice lanes, top (row 11) to bottom (row 18). Direction `left` means the
vehicles enter from the right edge and slide left (mirror the sprite); `right` means
they enter from the left edge and slide right. Speed is in tiles/second at level 1;
Gap is the whole-tile span of clear ice between consecutive vehicles in that lane.
Implement these exactly.

| Row | Vehicle | Length | Direction | Speed (L1) | Gap |
| --- | --- | --- | --- | --- | --- |
| 11 | Snow plow (`assets/plow/`) | 3 tiles | left | `1.7` | 8 tiles |
| 12 | Car (`assets/car/`) | 2 tiles | right | `2.1` | 7 tiles |
| 13 | Dogsled (`assets/dogsled/`) | 2 tiles | left | `2.5` | 7 tiles |
| 14 | Snow plow (`assets/plow/`) | 3 tiles | right | `1.6` | 8 tiles |
| 15 | Car (`assets/car/`) | 2 tiles | left | `2.0` | 7 tiles |
| 16 | Dogsled (`assets/dogsled/`) | 2 tiles | right | `2.3` | 7 tiles |
| 17 | Snow plow (`assets/plow/`) | 3 tiles | left | `1.5` | 8 tiles |
| 18 | Car (`assets/car/`) | 2 tiles | right | `1.8` | 7 tiles |

The lane speeds span `1.5`–`2.5` tiles/second, slower and narrower than the water
(`specs/water.md`).

Per-level scaling (`specs/gameplay.md`). Each level `L` (1-based):

- every lane speed is multiplied by `1.06^(L-1)` (about `+6%` per level);
- every lane gap widens by `⌊(L-1)/3⌋` tiles (`+1` tile from level 4, `+2` tiles
  from level 7), so the field thins slightly as it speeds up.

The ice band is the easier zone: slow vehicles and clear gaps at level 1, the speeds
climbing gently with the level. The water band is where the real speed and risk live
(`specs/water.md`).
