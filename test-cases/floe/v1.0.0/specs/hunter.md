# The Hunter

## Overview

This file defines the signature system of Floe: the **bear** that hunts the critter
across the whole strait. **Read this file carefully.** It builds on the bands in
`specs/playfield.md`, the hazards in `specs/hazards.md`, and the water in
`specs/water.md`, and it is the thing that makes Floe more than a lane-crossing
game. The numeric values here are a **starting balance**, meant to be tuned by play;
implement them as written but keep them easy to adjust.

## What the bear is

The bear is a single live predator — a big white animal, about one tile, rendered
from the provided sprite (`specs/assets.md`). It is **not** a lane hazard and
**not** a timer: it has a tile position on the strait and it **hops toward the
critter**, one tile at a time, following it wherever it goes. Touching the critter
kills it (below).

## The bear hops — the same way the critter moves

The bear moves by **discrete one-tile hops**, exactly like the critter — **not**
a
smooth continuous glide. Each hop takes it one tile up, down, left, or right (never
diagonally, never more than one tile), and it **navigates the grid the same way
the
critter must**: it hops onto solid ice, rides and hops between floes, and swims
across open water, tile by tile. Between hops it sits on its tile, so the player
can
read where it is and where it is about to go.

- **Hop cadence.** The bear completes a hop about every **`0.33 s`** on solid ice
  (roughly 3 tiles/second) and every **`0.5 s`** while swimming across the water
  (roughly 2 tiles/second) at level 1. A critter that keeps hopping forward promptly
  moves faster than this and **stays ahead** — but the bear closes about a tile
  for
  every hop-length the critter **hesitates, backtracks, or gets stuck**, so it gains
  on any pause or mistake. Swimming is slower, so committing to the water buys the
  critter a little tempo, but does **not** shake the bear.
- **It respects the same movement rules the critter does.** Each hop it steps one
  tile toward the critter along a route that **avoids the sliding hazards** (below);
  it does not teleport, phase through walls, or move faster than its hop
  cadence. It
  can occupy any tile the critter can reach — solid ice, a floe, or open water —
  but
  it **cannot** enter the far shore's solid wall or a **filled bay**
  (`specs/playfield.md`), so a critter safe in a filled bay is safe from the bear.

## Emerging and resetting

- **Emerge.** At the start of a crossing the bear is not yet on the board. It
  **emerges from the near shore** (row 19, `specs/playfield.md`) once the
  critter has
  hopped **a few tiles forward** off the near shore — so a fresh crossing always
  begins with a short head start, not an instant threat.
- **Reset on a new crossing.** When a crossing ends — the critter dies
  (`specs/flow.md`) **or** fills a bay (`specs/water.md`) and a new crossing
  begins —
  the bear is **removed** and re-emerges only after the new critter has again
  hopped a
  few tiles forward. The bear is never sitting on top of a just-respawned critter.

## Navigating the hazards — and getting reset by them

The bear is **not** immune to the world — it navigates the same hazard board the
critter does, and it can be **taken out** by the hazards:

- It **avoids the sliding hazards** (`specs/hazards.md`): it will not hop into a
  tile
  a hazard occupies, and **routes around** them, so a hazard-choked lane
  **delays and
  detours** it. Leading the bear into a lane a hazard is sweeping is a
  legitimate way
  to open distance.
- **If a hazard catches the bear, the bear is RESET.** If a plow or dogsled runs
  into
  the bear's tile (you juke it into traffic, or it mistimes a lane), the bear is
  **knocked out and removed** — it does **not** shrug it off, and it does **not**
  merely drop back a row. It then **re-emerges from the near shore** after a short
  delay, exactly as when a crossing begins. So driving the bear in front of a hazard
  is a real tool: it buys you the whole time it takes the bear to re-emerge and
  hop
  back up to you.

(The critter is killed by the hazards, but the bear is only reset by them — the
hunt
returns; it is never permanently removed.)

## Always visible

The player must be able to **see where the bear is at all times** — a hunter you
cannot track is unfair:

- On ice and on a floe the bear is drawn fully, and because it is a white animal
  on
  pale ice it always carries its **dark outline** (`specs/assets.md`) so it never
  vanishes against the ice.
- While **swimming**, the bear is mostly submerged: draw it as its **submerged
  silhouette with a wake/ripple** on the surface (`specs/assets.md`'s swim frames),
  so even under the water — or passing beneath a floe — its position stays clearly
  readable. The bear is **never** invisible.

## Catching the critter

If the bear reaches the critter — its tile lands on the critter's (or comes within
about half a tile) — the critter is **caught** and **loses a life**
(`specs/flow.md`), wherever they are on the strait. This is the pressure behind
the
whole game: you can never stop and wait, because the bear is always hopping closer.

## Difficulty

- The bear's hop cadence **quickens** with the level: its hop interval shrinks about
  **6%** per level (both ice and swim), so late crossings give far less slack for
  hesitation.
- From **level 5** onward a **second bear** emerges (staggered from the first),
  so
  the strait is hunted from two positions at once.

## Why this is the game

The hazards and floes are the classic crossing puzzle; the bear is what turns it
into
a **chase**. Because it hops after you across the whole board and only its cadence
holds it back, every classic "wait on a safe tile for the lane to clear"
instinct is
a trap — the safe tile is where the bear catches up. Floe is about **reading the
whole
board and committing**: keep moving, spend the hazards against the bear (lure it
into
traffic to reset it) and the water's tempo to gain ground, and never pause
longer than
your lead allows, all the way to a bay.
