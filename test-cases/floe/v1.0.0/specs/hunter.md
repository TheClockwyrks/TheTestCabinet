# The Hunter

## Overview

This file defines the signature system of Floe: the **bear** that hunts the
critter across the whole strait. **Read this file carefully.** It builds on the
bands in `specs/playfield.md`, the hazards in `specs/hazards.md`, and the water
in
`specs/water.md`, and it is the thing that makes Floe more than a lane-crossing
game. The numeric values here are a **starting balance**, meant to be tuned by
play; implement them as written but keep them easy to adjust.

## What the bear is

The bear is a single live predator — a big white animal, about one tile, rendered
from the provided sprite (`specs/assets.md`). It is **not** a lane hazard and
**not** a timer: it has a position on the strait and it **moves toward the critter
every step**, following it wherever it goes. Touching the critter kills it (below).

## Emerging and resetting

- **Emerge.** At the start of a crossing the bear is not yet on the board. It
  **emerges from the near shore** (row 19, `specs/playfield.md`) once the critter
  has hopped **a few tiles forward** off the near shore — so a fresh crossing always
  begins with a short head start, not an instant threat.
- **Reset.** When a crossing ends — the critter dies (`specs/flow.md`) **or** fills
  a bay (`specs/water.md`) and a new crossing begins from the near shore — the bear
  is **removed** and re-emerges only after the new critter has again hopped a few
  tiles forward. The bear is never sitting on top of a just-respawned critter.

## Pursuit

The bear continuously moves toward the critter's current position:

- On **solid ice** (the shores, the median, the ice band) it moves at about **4.5
  tiles per second** at level 1. A cleanly-played critter — one that keeps hopping
  forward promptly — moves faster than this and **stays ahead**; but the bear
  gains roughly a tile for every second the critter **hesitates, backtracks, or
  gets stuck**, so it closes on any pause or mistake.
- Across **water** the bear **swims**, moving more slowly — about **3.0 tiles per
  second** — so committing to the water buys the critter a little tempo, but does
  **not** shake the bear: it follows out onto the floes and through the sea after
  you (`specs/water.md`). The bear can occupy any tile the critter can reach —
  solid ice, a floe, or open water — it is never walled out of a band.
- The bear takes the shortest route toward the critter that its navigation
  (below) allows; it does not teleport, phase through walls, or move faster than
  its speed. It cannot enter the far shore's solid wall or a filled bay
  (`specs/playfield.md`) — those block it as they block the critter — so a critter
  safe in a **filled bay** is safe from the bear.

## Navigating the hazards

The bear is **not** immune to the world — it navigates the same board the critter
does:

- It **avoids the sliding hazards** (`specs/hazards.md`): it will not walk into
  a
  tile a hazard occupies, and **paths around** them, so a hazard-choked lane
  **delays and detours** it. Leading the bear into a lane a hazard is sweeping
  is a
  legitimate way to open distance.
- If a hazard **does** catch the bear (you juke it into one), the bear is
  **staggered** — knocked back and briefly stopped (about `0.6 s`) — a short
  reprieve you can engineer. A hazard does **not** kill the bear; the hunt is
  never removed mid-crossing, only slowed.
- On the water the bear swims around nothing (the floes are not obstacles to it),
  but it still moves at its slower swim speed.

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

If the bear reaches the critter — its tile overlaps the critter's (or comes within
about half a tile) — the critter is **caught** and **loses a life**
(`specs/flow.md`), wherever they are on the strait. This is the pressure behind
the
whole game: you can never stop and wait, because the bear is always closing.

## Difficulty

- The bear's speeds scale up with the level: about **+6%** per level to both its
  ground and swim speed, so late crossings give far less slack for hesitation.
- From **level 5** onward a **second bear** emerges (staggered from the first),
  so
  the strait is hunted from two positions at once.

## Why this is the game

The hazards and floes are the classic crossing puzzle; the bear is what turns it
into a **chase**. Because it pursues you across the whole board and only its speed
holds it back, every classic "wait on a safe tile for the lane to clear" instinct
is a trap — the safe tile is where the bear catches up. Floe is about **reading
the
whole board and committing**: keep moving, spend hazards and the water's tempo
against the bear, and never pause longer than your lead allows, all the way to a
bay.
