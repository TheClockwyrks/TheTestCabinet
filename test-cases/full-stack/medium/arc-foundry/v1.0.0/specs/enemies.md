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
- **The Load can be put under status effects**, but there is **still no armor or
  damage-type system** — every shot always removes HP, and no unit is immune or
  resistant. Two effects exist (`specs/towers.md`); each only changes a unit's
  **speed** or applies **extra HP loss over time**, never blocking a shot:
  - **slow** — a **Choke** hit (or a combination tower carrying slow) cuts the struck
    unit's speed for a short duration. The **strongest** slow wins and each fresh hit
    **refreshes** it; slows do **not** stack.
  - **burn** — a **Rectifier** hit (or a combo carrying burn) sets a **damage-over-time**
    that keeps ticking after the shot lands. The **strongest** burnDps wins and each
    fresh hit **refreshes** its duration; burns do **not** stack.
- Per-wave scaling (HP growth as the waves deepen) uses the formula below with
  constants set by **difficulty** (`specs/modes.md`); the values in the roster are
  the **base** (Wave 1, Medium) stats before scaling.

## The Load roster

Bounties are on the **GemTD scale** — a basic unit pays `1` Charge — so kill income is thin
(`specs/flow.md`); they are integer values and do **not** scale with the wave.

| Type | Trait | Base HP | Speed | Flies? | Bounty | Leak |
| --- | --- | --- | --- | --- | --- | --- |
| **Mote** | baseline charge unit | 44 | 60 | no | 1 | 1 |
| **Spark** | fast, fragile | 27 | 120 | no | 1 | 1 |
| **Slug** | slow, capacitive tank | 180 | 38 | no | 3 | 2 |
| **Cluster** | tiny, arrives in dense packs | 16 | 72 | no | 1 | 1 |
| **Filament** | **flyer** — ignores the maze | 74 | 85 | **yes** | 2 | 1 |
| **Dynamo** | **boss** — overload core | 1500 | 30 | no | 40 | 5 |

- **Mote** — the standard unit, with average HP and speed; everything else is a
  variation on it.
- **Spark** — about half a Mote's HP at double its speed.
- **Slug** — a slow unit with a huge HP pool that costs **2** Grid Integrity if it
  grounds out.
- **Cluster** — very low HP, but arrives in tight packs (many at once).
- **Filament** — the **flyer**. It appears **only on every fourth wave** (waves `4`,
  `8`, `12`, … — see *Wave composition* below) and does **not** walk the maze: it flies
  in a straight line from the Entry through each waypoint in order to the Collector, over
  every component and wall (`specs/board.md`). The maze cannot slow or redirect it, but
  any component in range can still fire at it while it is over the yard. Its exposure
  window over the yard is short.
- **Dynamo** — the **boss**: a massive HP pool that costs **5** Grid Integrity if it
  grounds out. It seethes with instability (an unstable-overload wobble, and a big
  EMP-style discharge on death — `specs/flow.md`) and anchors the **milestone
  waves** (`specs/flow.md`, `specs/modes.md`).

## The post-final Overload Dynamo (invincible; the maze rating)

After the **final wave** is cleared, one special boss runs the **maze-rating finale**
(`specs/flow.md`): an **Overload Dynamo** — a single **invincible** unit that walks the
maze once so the game can measure how much damage the player's maze deals.

- It spawns at the **Entry** and walks the ordered waypoint chain to the **Collector**
  exactly like any ground unit, taking the shortest open route around the walls, at a
  brisk pace (faster than the campaign Dynamo, so the finale is a short single pass).
- It **cannot be killed**: it has no depleting health bar, and every shot's full damage
  (and every burn tick) is **tallied into the run's Maze Rating** instead of removing HP.
  It still takes **slow** and **burn** (which keep it under fire longer, raising the
  rating), but its HP never falls.
- When it grounds out at the Collector it costs **no** Grid Integrity — the run is already
  won — and the game shows the **Victory** screen with the final Maze Rating
  (`specs/flow.md`). It reads on the board as an oversized, roiling overload core.

## Per-wave HP scaling

Only **HP** grows as the campaign deepens; **speeds, bounties, and leak values do
not scale**, and no component stat changes across waves — only the Load grows. A
unit's HP on wave `w` is:

```
HP(w) = baseHP × baseMult × (1 + k × (w − 1))
```

- `baseHP` is the unit's base HP from the roster above.
- `baseMult` and `k` are set by the chosen **difficulty** and are the **only**
  things difficulty changes about a unit (`specs/modes.md`). On **Medium** — the
  reference, a **`50`-wave** run — they are `baseMult = 0.22` and `k = 1.17`;
  **Easy** is gentler and shorter (`40` waves, `baseMult = 0.20`, `k = 0.50`) and
  **Hard** steeper and longer (`60` waves, `baseMult = 0.24`, `k = 1.30`). The `k`
  values are lower than a short-campaign game's because the run is dozens of waves —
  otherwise the late HP would explode. The full table lives in `specs/modes.md`.
- Wave 1 (`w = 1`) yields `baseHP × baseMult`; each later wave adds `k` of that base
  per wave, so HP climbs **steeply** across the run. The low base multiplier keeps the
  **opening waves gentle** — fitting the GemTD build where you have only a tower or two
  early — while the steep `k` makes **late waves brutal**, so the run is a climb whose
  pressure builds as your kept-and-combined firing line does. A Hard late wave towers
  far above a Medium one, which — along with more waves supplying more kill income at
  the same rate — is why the economy (`specs/flow.md`) is held constant across
  difficulty.

## Wave composition

A wave is a timed sequence of units released from the Entry; the exact spawn timing
and per-wave mix are yours to design within `specs/flow.md`'s campaign progression.
Over the roughly **`50`** waves of a Medium run (`40` Easy / `60` Hard,
`specs/modes.md`), compose waves so no single component type answers everything and
so a thin or un-climbed maze — and one that never assembles **combination towers**
(`specs/towers.md`) — is overrun:

- **Early waves** are mostly **Motes** and **Sparks** — light enough to teach the
  maze, the scrap-press, and stamping.
- **Mid waves** bring **Clusters** (the splash/chain answer) and **Slugs** (the
  heavy single-hit answer).
- **Air waves — every fourth wave (`w % 4 == 0`: waves `4`, `8`, `12`, …)** — carry a
  **Filament** flyer contingent (alongside whatever ground units fit the progression),
  and **no other wave spawns Filaments**. This fixed cadence is the anti-air test: a
  defense with no coverage on the straight-line flyer path starts leaking on those
  waves. A milestone wave (`round(N/2)` or `N`) that also lands on a multiple of 4
  carries both its Dynamo and a Filament contingent.
- **Late waves** (the back third of the run) are dense mixes that press a maze that
  has not climbed the quality ladder or assembled **combination towers**
  (`specs/towers.md`) — the power to clear them comes from combining up, building the
  recipe combos, and refining the press, not from flooding the board with Scrap.
- A **Dynamo** boss anchors each **milestone wave** — the midpoint `round(N / 2)` and
  the final wave `N` of the run (Wave `25` and Wave `50` on Medium; `specs/modes.md`,
  `specs/flow.md`) — with the surrounding wave growing toward the late game.
- Mix types so the player cannot answer everything with one component: Sparks want
  coverage near the Entry, Slugs want concentrated heavy hits, Clusters want splash
  and chain, Filaments want anti-flyer coverage on the straight-line path, and a
  Dynamo wants raw climbed output. Reading the **next-wave preview** in the build
  panel (`specs/board.md`, `specs/flow.md`) and re-shaping the maze for it is the
  between-wave game. Each unit name in the next-wave preview is **hoverable**: pointing at
  it floats a **tooltip** describing that unit's defining trait, so the player can learn
  the roster without leaving the board.
