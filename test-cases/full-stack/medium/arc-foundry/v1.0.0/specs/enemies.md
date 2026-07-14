# The Load

## Overview

This file defines the **Load** — the runaway charge you defend against: its unit
types, the flyer that ignores the maze, the boss, and how a unit's health grows as
the waves deepen. It builds on the waypoint pathing and mazing in `specs/board.md`,
the components in `specs/towers.md`, the wave campaign and economy in
`specs/flow.md`, and the difficulty menu that sets the HP-scaling constants in
`specs/modes.md`. Speeds are in logical pixels/second; HP, bounty, and leak are
unitless game values.

The stat numbers below are **fixed**; implement them exactly as written. Equally
important is the **behavior**: each type's defining trait, the flyer's
maze-bypassing flight, the boss anchoring the milestone waves, and that only HP
scales across waves.

## Shared rules

- Every unit spawns at the map's **Entry**, traverses the map's **ordered waypoint
  chain** (`specs/board.md`) — heading to each waypoint in sequence, taking the
  shortest **open** route around the walls the player has built between consecutive
  waypoints — and **grounds out (leaks)** at the **Collector**, where it is
  removed.
- A unit that reaches the Collector **leaks**: it costs the player its leak value
  in **Grid Integrity** and is removed, with a leak-alarm effect (`specs/flow.md`).
- A killed unit pays its **bounty** in **Charge** to the player the instant it dies
  (`specs/flow.md`).
- Each unit shows a small **health bar** above it that depletes as it takes damage.
  Units are drawn as on-theme charge units off the electro-industrial palette
  (`specs/overview.md`); the Filament reads as airborne, the Dynamo as an overload
  core.
- **All components hit both ground and flying units** — electricity arcs to
  anything (`specs/towers.md`). There is no damage-type or armor system; a shot
  removes HP.
- Per-wave scaling (HP growth as the waves deepen) uses the formula below with
  constants set by **difficulty** (`specs/modes.md`); the values in the roster are
  the **base** (Wave 1, Medium) stats before scaling.

## The Load roster

| Type | Trait | Base HP | Speed | Flies? | Bounty | Leak |
| --- | --- | --- | --- | --- | --- | --- |
| **Mote** | baseline charge unit | 30 | 60 | no | 3 | 1 |
| **Spark** | fast, fragile | 18 | 120 | no | 3 | 1 |
| **Slug** | slow, capacitive tank | 180 | 38 | no | 7 | 2 |
| **Cluster** | tiny, arrives in dense packs | 10 | 72 | no | 2 | 1 |
| **Filament** | **flyer** — ignores the maze | 55 | 85 | **yes** | 6 | 1 |
| **Dynamo** | **boss** — overload core | 1500 | 30 | no | 90 | 5 |

- **Mote** — the standard unit; everything else is a variation on it. The bulk of
  the early waves.
- **Spark** — half a Mote's HP at double its speed. Sparks blow through a long maze
  fast, so they punish a defense with no coverage near the Entry — a line that only
  catches units at the far end of the maze leaks them.
- **Slug** — a slow wall of HP that soaks fire and leaks **2** Grid Integrity if it
  grounds out. Slugs reward concentrated single-hit damage — a **Discharge Rig**'s
  heavy bolt or a climbed, high-quality line — not a spread of weak Scrap.
- **Cluster** — very low HP but arrives in tight packs (many at once), so a single
  Cluster pack floods a chokepoint. **Arc-Node** splash and **Coil** chain
  (`specs/towers.md`) are the natural answers.
- **Filament** — the **flyer**. It does **not** walk the maze: it flies in a
  straight line from the Entry through each waypoint in order to the Collector, over
  every component and wall (`specs/board.md`). The maze cannot slow or redirect it,
  but any component in range can still fire at it while it is over the yard. Because
  it bypasses the maze its **exposure window is short**, so it is dangerous not for
  being tough but for demanding coverage sitting near the straight-line waypoint
  path — a defense with none starts leaking Filaments.
- **Dynamo** — the **boss**: a massive HP pool that leaks **5** Grid Integrity if it
  grounds out. It seethes with instability (an unstable-overload wobble, and a big
  EMP-style discharge on death — `specs/flow.md`) and anchors the **milestone
  waves** (`specs/flow.md`, `specs/modes.md`). It is the trial of whether your
  climbed, combined line can output enough damage to break it before it crosses the
  yard.

## Per-wave HP scaling

Only **HP** grows as the campaign deepens; **speeds, bounties, and leak values do
not scale**, and no component stat changes across waves — only the Load grows. A
unit's HP on wave `w` is:

```
HP(w) = baseHP × baseMult × (1 + k × (w − 1))
```

- `baseHP` is the unit's base HP from the roster above.
- `baseMult` and `k` are set by the chosen **difficulty** and are the **only**
  things difficulty changes about a unit (`specs/modes.md`). On **Medium** they are
  the reference values `baseMult = 1.0` and `k = 0.20`; **Easy** is gentler
  (`baseMult = 0.85`, `k = 0.15`) and **Hard** steeper (`baseMult = 1.15`,
  `k = 0.26`). The full table lives in `specs/modes.md`.
- Wave 1 (`w = 1`) yields `baseHP × baseMult`; each later wave adds `k` of that base
  per wave, so HP climbs linearly across the run. A Hard late wave therefore towers
  far above a Medium one, which — along with more waves supplying more kill income at
  the same rate — is why the economy (`specs/flow.md`) is held constant across
  difficulty.

## Wave composition

A wave is a timed sequence of units released from the Entry; the exact spawn timing
and per-wave mix are yours to design within `specs/flow.md`'s campaign progression.
Compose waves so no single component type answers everything and so a thin or
un-climbed maze is overrun:

- **Early waves** are mostly **Motes** and **Sparks** — light enough to teach the
  maze, the scrap-press, and stamping.
- **Mid waves** bring **Clusters** (the splash/chain answer) and **Slugs** (the
  heavy single-hit answer); **Filaments** begin appearing, so a defense with no
  coverage on the flyer line starts leaking.
- **Late waves** are dense mixes that press a maze that has not climbed the quality
  ladder (`specs/towers.md`) — the power to clear them comes from combining up, not
  from flooding the board with Scrap.
- A **Dynamo** boss anchors each **milestone wave** — the midpoint and the final
  wave of the run (`specs/modes.md`, `specs/flow.md`) — with the surrounding wave
  growing toward the late game.
- Mix types so the player cannot answer everything with one component: Sparks want
  coverage near the Entry, Slugs want concentrated heavy hits, Clusters want splash
  and chain, Filaments want anti-flyer coverage on the straight-line path, and a
  Dynamo wants raw climbed output. Reading the **next-wave preview** in the build
  panel (`specs/board.md`, `specs/flow.md`) and re-shaping the maze for it is the
  between-wave game.
