# The Water Band — Floes

## Overview

This file defines the **water band** (rows 4–11, `specs/playfield.md`): eight lanes
of deadly sea crossed only by riding drifting **floes**, and how the critter
reaches the far-shore bays. It uses the grid and palette from `specs/overview.md`.
The bear swims this band too (`specs/hunter.md`). The exact floe speeds, sizes,
and
spacing are a **starting balance** you design; the behavior here is fixed.

## Deadly water

Every tile of the water band is deep, freezing sea. **Standing on a water tile with
no floe under the critter is death** — the critter falls in and **loses a life**
(`specs/flow.md`). The critter crosses only by hopping onto floes and riding them.

## Drifting floes

Each of the eight water rows is a **lane** carrying drifting **floes** — pans of
ice, rendered from the provided sprite (`assets/pan/`, `specs/assets.md`):

- Each lane has a fixed **direction** and **speed**; **alternate the direction**
  lane to lane and vary the speeds, as with the ice band (`specs/hazards.md`).
- A floe is one or more tiles wide (a run of adjacent pan tiles that move together).
  Give a mix of **sizes** — small floes that demand a precise landing and larger
  ones that are more forgiving — and spacing with real gaps of open water between
  them. You design the sizes and gaps so every lane is crossable but tense.
- Floes drift straight along their lane and respawn at the far edge, like the
  hazards.

## Riding and drifting

- When the critter is standing **on a floe**, it is **carried with the floe**: each
  step, the critter drifts sideways at the floe's speed and direction, exactly as
  if it were part of the floe. Its grid position moves with the ice under it.
- A **hop** is always **one absolute tile** in the pressed direction
  (`specs/controls.md`) — the drift and the hop are separate: between hops the floe
  carries the critter, and a hop moves it one tile relative to the strait. To make
  progress the critter hops from floe to floe, timing the gaps.
- **Off-edge death.** If the floe carries the critter to the side edge and would
  sweep it **off the strait** (past the left or right edge), the critter is lost
  and
  **loses a life**. You must hop off a floe before it drifts you off the edge —
  riding one to the edge is fatal.
- Hopping onto **open water** (a tile with no floe) is death (above); hopping onto
  another floe, or back onto the median shelf (row 12) or into a bay, is safe.

## Reaching the bays

The top water lane is **row 4**, just below the far shore (rows 0–3,
`specs/playfield.md`). From a floe in row 4 the critter hops **up into an open bay**
in row 3 to complete the crossing:

- Landing in an **open** bay fills it, scores, and starts a fresh crossing from
  the
  near shore (`specs/flow.md`, `specs/playfield.md`).
- A hop up that would land on a **filled** bay or on the **solid shore** between
  bays is **refused** — the critter does not move (there is no footing there and
  no
  falling to death from a refused hop; it simply cannot go there). Line up under
  an
  open bay and hop in.

## Numbers (starting balance)

| Quantity | Value |
| --- | --- |
| Water-band lanes | 8 (rows 4–11) |
| Floe speed range | about `1.5`–`4` tiles/second |
| Floe sizes | mix of `1`–`3` tiles wide |
| Per-level speed increase | about `+6%` per level (`specs/flow.md`) |
| Off a floe onto water / off the edge | death (lose a life) |

Keep the water band **crossable** at level 1 — forgiving floe sizes, real gaps,
moderate speeds — and let the speeds climb and the floes shrink and thin with the
level (`specs/flow.md`).
