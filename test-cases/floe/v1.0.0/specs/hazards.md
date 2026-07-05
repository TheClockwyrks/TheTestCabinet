# The Ice Band — Hazards

## Overview

This file defines the **ice band** (rows 13–18, `specs/playfield.md`): six lanes
of
solid pack ice, each with **sliding hazards** the critter must dodge. It uses the
grid and palette from `specs/overview.md`. The bear navigates these hazards too
(`specs/hunter.md`). The exact speeds, directions, and spacing are a **starting
balance** you design; the behavior here is fixed.

## Lanes of sliding hazards

Each of the six ice-band rows is a **lane**. The ice itself is solid — the critter
may hop onto and pause on any ice tile — but **hazards slide across the lane**
horizontally, and touching one is death.

- Each lane has a fixed **direction** (left or right) and a fixed **speed**.
  **Alternate the direction** lane to lane so the band reads as a legible weave
  of
  opposing traffic, and vary the speeds so some lanes are quick and some slow.
- Hazards enter from one side edge, slide straight across their lane, and leave
  at
  the far edge, respawning so each lane stays populated with gaps the critter can
  time. You design the spacing (the gaps) so every lane is crossable but pressured.
- **Contact is death.** If a hazard's tile overlaps the critter's tile, the critter
  is crushed and **loses a life** (`specs/flow.md`). The critter is safe only in
  the **gaps** between hazards, and safe from hazards on the shores and median
  (`specs/playfield.md`) — but never safe from the bear.

## Hazard types

Two kinds of hazard populate the lanes, rendered from the provided sprites
(`specs/assets.md`):

- **The crawler** — a heavy tracked machine (`assets/crawler/`). Draw it facing
  the
  way its lane moves (mirror the sprite for a left-moving lane). Use it for the
  **faster, mechanical** lanes.
- **The berg** — a jagged chunk of drifting ice (`assets/berg/`). Use it for the
  **slower, heavier** lanes.

Both are about one tile. Give the band variety — some crawler lanes, some berg
lanes — so the six lanes do not all read the same. (You may run a lane as a short
train of two or three of the same hazard with a gap after, for a "big vehicle"
feel; the hazard is still deadly tile by tile.)

## Numbers (starting balance)

| Quantity | Value |
| --- | --- |
| Ice-band lanes | 6 (rows 13–18) |
| Lane speed range | about `2`–`5` tiles/second |
| Per-level speed increase | about `+6%` per level (`specs/flow.md`) |
| Hazard contact | death (lose a life) |

Keep the ice band **crossable with good timing** at level 1 — clear gaps, moderate
speeds — and let the speeds and density climb with the level (`specs/flow.md`).
