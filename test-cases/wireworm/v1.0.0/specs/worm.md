# The Data-Worm

## Overview

This file defines the data-worm: how it is built from segments, how it winds down
the board, how your shots split and shorten it, and how it grows the field. It
builds on the tile grid in `specs/playfield.md` and the charge rules in
`specs/charge.md`. The numeric values here are **fixed**; implement them exactly
as written.

## Structure

A worm is a **chain of segments**, each occupying one tile (`specs/playfield.md`)
and rendered from the provided worm sprite (`specs/assets.md`):

- The leading segment is the **head** (it carries the sensor eye and mandibles).
- The trailing segment is the **tail** (tapered).
- Every segment between them is a **body** segment.

The body follows the head: each segment moves into the tile the segment ahead of
it just left, so the chain snakes along the head's exact path one tile at a time
(a body segment is never diagonal to its neighbor). The head leads; the rest
trail.

## Winding down the board

The worm moves in discrete tile **steps** at a fixed cadence. It travels
horizontally along its current row until something turns it:

- On each step the head advances one tile in its current horizontal direction
  (left or right).
- **When the head is blocked** — by a node in the next tile, by another worm
  segment, or by the side edge of the board — the worm **drops one row** (in its
  current vertical direction, see below) and **reverses** its horizontal
  direction. The body follows along the same path on the following steps.
- A node the head is blocked by is **charged** by that collision (`specs/charge.md`:
  `C = min(3, C + 1)`). Hitting the side edge or another segment turns the worm
  but charges nothing.

**Vertical direction.** The worm starts moving **down** (each drop takes it one
row lower). When a drop would take it below the **bottom row** (row `19`), it
instead flips its vertical direction to **up**; when a later drop would take it
above the top playable row, it flips back to **down**. So the worm descends to the
floor, then climbs, then descends again — oscillating across the lower board, and
spending dangerous time in the **player band** (`specs/playfield.md`) until you
clear it. It never leaves the board through an edge; edges only turn it.

**Entry.** At the start of a level the worm enters along the **top row** (row `0`)
from the left or right edge, moving horizontally, vertical direction **down**
(`specs/playfield.md`).

**Speed.** At level 1 the worm takes one tile step every **0.14 s** (about 7 tiles
per second). Each level shortens the step interval by about **5%** (so the worm
quickens as levels climb), down to a floor of about **0.07 s**. Speed does not
otherwise change during a level.

## Diving on a critical node

When the head is blocked by a **critical** node (`C = 3`), the worm **dives**
instead of winding: it drives **straight down** its current column, one row per
step, ignoring nodes and walls, until it reaches the bottom row or the player band,
then resumes normal winding (`specs/charge.md`). A diving worm is a worm plunging
at you — the reason a standing critical cluster is a threat, not just a weapon.

## Shooting the worm — split, shorten, and grow the field

Your bolt travels up its column and hits the **first** worm segment in its path
(`specs/controls.md`). What happens depends on **which** segment it hits:

- **A head or tail (an end segment): the worm shortens.** The end segment is
  destroyed and the worm is one segment shorter; the next segment in becomes the
  new head (or tail).
- **A body (middle) segment: the worm splits.** The hit segment is destroyed and
  the chain breaks in two at that point, becoming **two independent worms** — the
  part ahead of the break (which keeps the old head) and the part behind it (whose
  leading segment becomes a **new head**, taking the head sprite and leading that
  worm from then on). Each new worm winds and is shot exactly like any other. A
  one-segment worm is just a head.
- **Every segment destroyed by a shot leaves a fresh inert node** (`C = 0`) in the
  tile where it died (`specs/charge.md`, `specs/playfield.md`). This is the
  field-growth engine: the more you cut the worm, the more nodes stand on the
  board, and the denser the field, the faster it steers the worm down at you. A
  segment destroyed by a **discharge** leaves **no** node (`specs/charge.md`).

Splitting is the heart of the fight: a long worm cut in the middle becomes two
shorter, faster-turning threats, each of which you must also clear — while every
cut you make salts the board with more nodes. Cutting near an end trades less
splitting for the same field growth.

## Length and level composition

- A level's worm is a single chain of **`10 + 2 * (level - 1)`** segments (10 at
  level 1, growing to 32 by level 12) entering from the top. You may instead split
  a level's budget across **two shorter worms** entering together in the later
  levels if it plays better — the total segment count is the guide, not a hard
  rule.
- A level is **cleared** when every worm segment on the board is gone — killed by
  shots or discharges (or lost, if one reaches you — that costs a life,
  `specs/flow.md`, but still removes it). Clearing the level advances to the next
  (`specs/flow.md`); the node field stays as it is (`specs/playfield.md`).
- The worm is **not** slowed, poisoned, or otherwise affected by charge except as
  stated here (charging nodes it hits, and diving on criticals). It has no health
  bar — every segment dies in one hit.

## Key numbers

| Quantity | Value |
| --- | --- |
| Tile step interval (level 1) | `0.14 s` |
| Step interval reduction per level | ~`5%` (floor ~`0.07 s`) |
| Drop on collision | 1 row |
| Charge added to a bumped node | `+1` (cap `3`, `specs/charge.md`) |
| Worm length | `10 + 2 * (level - 1)` segments |
| Node left by a shot-killed segment | 1 inert node (`C = 0`) |
| Node left by a discharge-killed segment | none |
