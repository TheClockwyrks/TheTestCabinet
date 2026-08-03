# The Hunter

## Overview

This file defines the signature system of Floe: the bear that hunts the critter
across the whole strait. It builds on the bands in `specs/playfield.md`, the hazards
in `specs/hazards.md`, and the water in `specs/water.md`. The numeric values here
are fixed; implement them exactly as written.

## What the bear is

The bear is a single live predator, a big white animal about one tile, rendered
from the provided sprite (`specs/assets.md`). It is not a lane hazard and not a
timer: it has a position on the strait and it moves toward the critter, following it
wherever it goes. Touching the critter kills it (below).

## The bear moves continuously, pacman-style

The bear does not hop from tile to tile. It glides continuously along the strait at
a fixed speed, the way a pursuer moves through a maze-chase game: it always travels
in one of the four grid directions (up, down, left, or right, never diagonally) and
it changes direction only when it reaches a tile center. At each tile center it
picks the grid direction that best closes on the critter along a route that avoids
the sliding hazards (below), then slides smoothly across to the next tile, where it
chooses again. The motion itself is smooth and continuous; only the turning is
quantized to the grid.

- Speed. The bear moves about `3` tiles/second on solid ice or a floe and about `2`
  tiles/second while swimming across open water, at level 1. A critter that keeps
  advancing promptly outruns it and stays ahead, while the bear eats about a tile of
  the critter's lead for every tile-length the critter hesitates, backtracks, or
  gets stuck, so it gains on any pause or mistake. Swimming is slower, so committing
  to the water buys the critter a little tempo, but does not shake the bear.
- It occupies both tiles while it is between them. Because it moves continuously,
  the bear is usually straddling two tiles: the one it is leaving and the one it is
  entering. For collision with the sliding hazards it is treated as occupying both
  of those tiles until it fully settles onto the next one (see Navigating the
  hazards below). For catching the critter it is a point at its current position.
- It respects the same board the critter does. It travels onto solid ice, rides and
  swims across floes and open water, and it cannot enter the far shore's solid wall
  or a filled bay (`specs/playfield.md`), so a critter safe in a filled bay is safe
  from the bear. It never teleports, phases through the far-shore wall, or exceeds
  its speed.

## Emerging and resetting

- Emerge. At the start of a crossing the bear is not yet on the board. It emerges
  from the near shore (row 19, `specs/playfield.md`) once the critter has advanced a
  few tiles forward off the near shore, so a fresh crossing always begins with a
  short head start, not an instant threat.
- Reset on a new crossing. When a crossing ends (the critter dies, `specs/gameplay.md`,
  or fills a bay, `specs/water.md`, and a new crossing begins) the bear is removed
  and re-emerges only after the new critter has again advanced a few tiles forward.
  The bear is never sitting on top of a just-respawned critter.

## Navigating the hazards, and getting reset by them

The bear is not immune to the world. It navigates the same hazard board the critter
does, and it can be taken out by the hazards:

- It avoids the sliding hazards (`specs/hazards.md`): it will not turn toward a tile
  a hazard occupies or is about to sweep into, and routes around them, so a
  hazard-choked lane delays and detours it. Leading the bear into a lane a hazard is
  sweeping is a legitimate way to open distance.
- If a hazard catches the bear, the bear is reset. Because the bear occupies both
  the tile it is leaving and the tile it is entering while it is between them
  (above), a plow, dogsled, or car that slides into either of those tiles knocks it
  out and removes it. It does not shrug it off, and it does not merely drop back a
  row. It then re-emerges from the near shore after a short delay, exactly as when a
  crossing begins. So driving the bear in front of a hazard is a real tool: it buys
  you the whole time it takes the bear to re-emerge and cross back up to you.
- The vehicle has to be the one that closed the distance. A vehicle resets the bear
  only when the vehicle's own motion brings it onto a tile the bear occupies; a bear
  that travels onto a vehicle is not reset by it. That is the rule the critter plays
  by — traffic kills by running into you, never by your stepping into it
  (`specs/hazards.md`) — and the bear respects the same board. It takes nothing away
  from the hazards: every vehicle in a lane is always moving, so a bear caught in one
  is caught by a vehicle that came to it, and a bear lured into a sweeping lane is
  still knocked out when that vehicle arrives.

The critter is killed by the hazards, but the bear is only reset by them; the hunt
returns rather than being permanently removed.

## Rendering the bear

Draw the bear from its provided frames (`specs/assets.md`), using the correct frame
for its current state:

- On ice and on a floe, draw the run frame for its current direction of travel.
- While swimming, draw the submerged swim frame set for its current direction
  (`specs/assets.md`'s swim frames), including while it passes beneath a floe, so it
  stays trackable as a silhouette with a wake and is never invisible.

## Catching the critter

If the bear reaches the critter (its position lands on the critter's, or comes
within about half a tile) the critter is caught and loses a life
(`specs/gameplay.md`), wherever they are on the strait. This is the pressure behind the
whole game: you can never stop and wait, because the bear is always closing.

## Difficulty

- The bear's speed increases with the level: about `+6%` per level (both its ice
  speed and its swim speed), so late crossings give far less slack for hesitation.
- From level 5 onward a second bear emerges (staggered from the first), so the
  strait is hunted from two positions at once.

## Why this is the game

The hazards and floes are the classic crossing puzzle; the bear is what turns it
into a chase. Because it pursues you across the whole board and only its speed holds
it back, the game is about reading the whole board and committing: keep moving,
spend the hazards against the bear by luring it into traffic to reset it, use the
water's tempo to gain ground, and never pause longer than your lead allows, all the
way to a bay.
