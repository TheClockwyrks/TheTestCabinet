# Charge

## Overview

This file defines the signature Charge system of Wireworm: how a node holds
charge, how the worm charges the field it winds through, what each of your shots
does to a node, and the **chain-arc discharge** a critical node sets off. **Read
this file carefully.** It builds on the tile grid in `specs/playfield.md`, drives
how the worm behaves in `specs/worm.md`, and is what the foes in `specs/foes.md`
manipulate.

## Node charge

Every node carries a single state: its **charge** `C`, an integer in `{0, 1, 2,
3}`. Charge is the *only* per-node state — a node is not otherwise damaged or
worn; how you clear it depends entirely on its charge (below).

Charge is shown by the node's sprite, one frame per level (`specs/assets.md`):

| `C` | State | Reads as |
| --- | --- | --- |
| 0 | **inert** | dark, unlit — a dead component |
| 1 | **low** | a faint teal glow in the core |
| 2 | **charged** | a bright cyan core with a faint glow halo |
| 3 | **critical** | white-hot core, bright halo, amber overcharge sparks, pulsing |

A **critical** node (`C = 3`) is loaded and dangerous, and must read
unmistakably as different from a merely charged one (`specs/overview.md`): it is
what detonates, and it is what makes the worm dive (below and `specs/worm.md`).

## The worm charges the field

The worm charges the terrain it steers on. Whenever a worm segment **collides
with a node** — the same collision that makes the worm drop a row and reverse
(`specs/worm.md`) — that node gains one charge:

```
C = min(3, C + 1)
```

- A node the worm bumps once is low; one it keeps ricocheting off climbs to
  critical. So the chokepoints the worm winds around the most are exactly the
  nodes that go critical — the field arms itself as a side effect of the worm
  doing what it does.
- Charge only ever rises from a worm bump (and from a corruptor, `specs/foes.md`);
  it never rises on its own and never from your shots. It does not decay over
  time — a charged node stays charged until you shoot it, it detonates, or it is
  removed.
- The worm charges a node **once per collision**, not continuously while touching
  it: each drop-and-reverse against a node is one `+1`.

## What your shots do to a node

Your cursor fires bolts straight up (`specs/controls.md`). A bolt travels up its
column until it hits the **first** node or worm segment in its path, then stops.
What a bolt does to a node it hits depends on that node's charge:

- **`C = 0` (inert): destroyed.** An inert node has no charge holding it together;
  a single bolt removes it, clearing the tile.
- **`C = 1` or `C = 2`: de-energized one level** — `C = C - 1`. The bolt knocks
  one level of charge out of the node but does **not** remove it. So a charged
  node resists clearing: you must shoot the charge out of it, level by level, and
  only the final bolt (once it is inert) removes it. A `C = 2` node therefore
  takes three bolts to clear (2 → 1 → 0 → gone).
- **`C = 3` (critical): detonates.** A bolt into a critical node does not
  de-energize it — it sets off the **chain-arc discharge** (below). This is the
  *only* way a critical node leaves the board, and it is how you clear a big
  charged cluster in one shot instead of whittling each node down.

There is no way for your shots to *raise* a node's charge; only the worm (and the
corruptor) charge the field. Your shots only ever push charge **down** — or, at
critical, blow it up.

## The chain-arc discharge — the signature

Shooting a **critical** node detonates it, and the detonation **chains** through
the charged cluster around it:

1. The detonated node is **removed** from the board (its tile clears).
2. It **arcs** to every **charged** node (`C >= 1`) whose tile is within **2
   tiles** of it — a Chebyshev radius of 2 (the surrounding 5 x 5 block of tiles,
   centered on the detonated node). Inert nodes (`C = 0`) do **not** conduct and
   are not consumed — arcs leap over them.
3. **Every node an arc reaches is itself detonated** — removed, and it arcs onward
   to the charged nodes within 2 tiles of *it*. The discharge floods outward
   through the connected web of charged nodes this way until no charged node
   remains within reach, clearing the whole cluster in one chain. (A node is
   detonated at most once per discharge; a fully-charged board can be cleared
   by a
   single well-placed shot — a payoff you had to let the worm build.)
4. **Every worm segment within 2 tiles of any detonated node is destroyed**,
   and —
   unlike a segment killed by a direct shot — a segment killed by a discharge
   leaves **no node** behind (`specs/worm.md`). A discharge is the clean kill: it
   culls the worm *and* thins the field at once, where shooting the worm normally
   thickens it.

The reach of a discharge is therefore the **connected set of charged nodes**, each
within 2 tiles of the next — so where the worm has charged a dense run of nodes,
one shot clears a wide swath and fries every segment threading through it; where
charge is sparse, a detonation is a small local pop. Draw the arcs as bright
`#b8ffe6` lightning between the detonating nodes (`specs/overview.md`); the arc
visuals are yours to render (there is no arc sprite — `specs/assets.md`).

## Critical nodes make the worm dive

A critical node is double-edged: it is your weapon, but until you detonate it, it
is a hazard. When a worm segment **collides with a critical node** (`C = 3`), in
addition to charging (which is already capped at 3, so the node stays critical),
the worm **enters a dive**: instead of the normal drop-one-row-and-reverse, it
drives **straight down** its current column, one row per step, ignoring nodes and
walls, until it reaches the bottom row or the player band, then resumes normal
winding (`specs/worm.md`).

So a charged cluster is an express lane: a worm that reaches it plunges toward you
instead of winding the long way down. This is the pressure that keeps the charged
field from being a free bank of weapons — a critical cluster you leave
standing is
a critical cluster the worm can ride into your band. Detonate criticals to clear
the worm and the terrain both; leave them and they may fast-track the worm at you.

## Why this is the game

Put together, charge is the whole tension of Wireworm:

- Shooting the worm normally **thickens** the field (each kill leaves a node), and
  a thicker field steers the worm **down faster** (`specs/worm.md`) — so fighting
  the worm the ordinary way makes your situation more dangerous over time.
- The worm **charges** the field it winds through, and a charged cluster is a
  loaded weapon — but also a dive-lane that fast-tracks the worm at you.
- A **discharge** is the release valve: it clears a whole charged swath and cleanly
  fries the worm through it, thinning the field instead of thickening it — but you
  can only build one by letting the worm run long enough to charge a cluster to
  critical, which is exactly when the situation is most dangerous.

Good play is pacing that cycle: let the field build and charge, then relieve it
with a great discharge at the right moment — not too early (a small pop), not too
late (the worm rides the criticals into your band).
