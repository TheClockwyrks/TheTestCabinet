# The Ice Band — Hazards

## Overview

This file defines the **ice band** (rows 13–18, `specs/playfield.md`): six lanes
of
solid pack ice, each with **sliding vehicles** the critter must dodge. It uses the
grid and palette from `specs/overview.md`. The bear navigates these hazards too,
and
is reset by them (`specs/hunter.md`). The exact speeds, directions, and spacing
are a
**starting balance** you design; the behavior here is fixed.

## Lanes of sliding vehicles

Each of the six ice-band rows is a **lane**. The ice itself is solid — the critter
may hop onto and pause on any ice tile — but **vehicles slide across the lane**
horizontally, and touching one is death.

- Each lane has a fixed **direction** (left or right) and a fixed **speed**.
  **Alternate the direction** lane to lane so the band reads as a legible weave
  of
  opposing traffic, and vary the speeds so some lanes are quick and some slow.
- Vehicles enter from one side edge, slide straight across their lane, and leave
  at
  the far edge, respawning so each lane stays populated with gaps the critter can
  time. You design the spacing (the gaps) so every lane is crossable but pressured.
- **Contact is death.** A vehicle is **more than one tile long** (below), and
  touching **any** tile it covers crushes the critter and **loses a life**
  (`specs/flow.md`). The critter is safe only in the **gaps** between vehicles,
  and
  safe from vehicles on the shores and median (`specs/playfield.md`) — but never
  safe
  from the bear.

## The two vehicles

Two kinds of vehicle populate the lanes, rendered from the provided sprites
(`specs/assets.md`). Both are **multi-tile vehicles** — the whole sprite moves
as one
unit and every tile it covers is deadly:

- **The snow plow** — a big, heavy machine **three tiles long**
  (`assets/plow/`). Use
  it for the **slow, heavy** lanes. Draw it facing the way its lane moves
  (mirror the
  sprite for a left-moving lane).
- **The dogsled** — a fast sled-dog team **two tiles long** (`assets/dogsled/`).
  Use
  it for the **quicker, lighter** lanes. Mirror it for a left-moving lane.

Give the band variety — some slow three-tile plow lanes, some fast two-tile dogsled
lanes — so the six lanes do not all read the same. A long plow leaves a smaller
gap
behind it than a dogsled at the same spacing, so the vehicle length is part of the
timing.

## Numbers (starting balance)

| Quantity | Value |
| --- | --- |
| Ice-band lanes | 6 (rows 13–18) |
| Plow length | 3 tiles (`assets/plow/`) |
| Dogsled length | 2 tiles (`assets/dogsled/`) |
| Lane speed range | about `2`–`5` tiles/second |
| Per-level speed increase | about `+6%` per level (`specs/flow.md`) |
| Vehicle contact (any covered tile) | death (lose a life) |

Keep the ice band **crossable with good timing** at level 1 — clear gaps, moderate
speeds — and let the speeds and density climb with the level (`specs/flow.md`).
