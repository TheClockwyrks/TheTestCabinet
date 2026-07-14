# Components

## Overview

This file defines the **five component types** stamped from the scrap-press — the
turrets you wall the yard with — their firing identities, the **quality ladder**
that scales them, and the full stat tables for every type at every quality. It
builds on the tile grid and the uniform footprint in `specs/board.md`, the Load
it fires at in `specs/enemies.md`, the scrap-press build loop (stamping odds,
slag, and the combine recipe) in `specs/build.md`, the placing/selecting/selling
controls in `specs/controls.md`, the economy in `specs/flow.md`, and the produced
sprites and electrical VFX in `specs/assets.md`. Ranges are in logical pixels
(`specs/board.md`); Charge values are the unitless money of `specs/flow.md`.

The stat numbers below are **fixed** for this version; implement them exactly as
written. Equally important is the **behavior**: five distinct firing identities,
the steep quality power curve that makes combining always pay, the Coil's chain
and the Arc-Node's splash, per-component targeting, the rotating head, and the
rule that every shot is a **traveling projectile that carries its hit**.

## The five component types

Each component is a salvaged electrical part with its own firing identity and
signature VFX. Every component **fires automatically** at a valid in-range unit —
there is no manual trigger — and **all five hit both ground and flying** units
(electricity arcs to anything, so a flyer over the yard is a legal target,
`specs/enemies.md`). A component with nothing in range **holds fire**.

| Type | Role / stance | Signature VFX (`specs/assets.md`) |
| --- | --- | --- |
| **Capacitor** | balanced single-target zap — the common workhorse | a crisp blue-white **bolt** |
| **Coil** | **chain-lightning** — the hit leaps to nearby extra targets | lightning **arcing between units** |
| **Emitter** | rapid low-damage spark — anti-swarm | a fast **spark spray** |
| **Arc-Node** | **area discharge** — damages everything around the impact | an expanding **discharge ring** |
| **Discharge Rig** | slow, long-range heavy bolt — the anti-tank sniper | a fat **capacitor-bank crack** |

A component is **never bought at a chosen type or quality**: it is created only by
stamping the press or by combining matches (`specs/build.md`). What you build with
is what the press hands you, so the roster is played by *shaping* random rolls,
not by picking towers off a shop.

## The quality ladder

Every component carries a **quality tier** on a five-rung ladder from crude salvage
to a pristine artifact. Quality is the **power axis**: it multiplies damage and
nudges range, and it must **read at a glance** — sprite finish and VFX intensity
escalate every rung (`specs/assets.md`), so a board of Scrap looks like a junkyard
and a Tesla-Prime looks like a lightning god.

| Tier | Quality | Reads as |
| --- | --- | --- |
| **T1** | **Scrap** | pitted, rusted, a dim flicker |
| **T2** | **Tuned** | cleaned, a steady glow |
| **T3** | **Charged** | polished, bright, humming |
| **T4** | **Primed** | machined, arcing at rest |
| **T5** | **Tesla-Prime** | mirror-chromed, wreathed in continuous arcs |

The quality-tier names are deliberately distinct from the component-**type** names
so the two axes never collide: a component is always a *type* (what it does) at a
*quality* (how hard). You climb the ladder by **combining** two matching
components (same type **and** same quality) into one component a tier higher; the
recipe, odds, and the free-of-Charge climb live in `specs/build.md`.

## How quality scales a component (LOCKED)

A component's stats derive from its **base (Scrap / T1)** stats and its quality
tier, by these fixed rules:

- **Damage** = base damage **× quality multiplier**: T1 `×1.0`, T2 `×2.2`, T3
  `×5.0`, T4 `×11`, T5 `×24`. The curve is deliberately **steep** so combining two
  components always out-damages the two it consumed (`specs/build.md`) — the
  board's power comes from *climbing*, not from flooding the yard with Scrap.
- **Range** = base range **+ 2 px per tier above T1** (so T3 is `+4`, T5 is
  `+8`).
- **Fire rate** is **flat across quality** — a component's firing cadence is part
  of its identity and never changes with tier. Quality is the power axis, cadence
  is the identity axis.
- **Footprint** is the uniform **2×2 tiles (40×40 px)** at every quality
  (`specs/board.md`); there are no size variants.
- **Coil chain length** and **Arc-Node splash radius** step up with quality (below).

## Shared firing and targeting rules

- **Range** is a radius in logical pixels measured from the **center of the 2×2
  footprint** (`specs/board.md`); a unit whose position is within that radius is
  targetable, ground or flying.
- Each component fires at its **fire rate** (shots per second) whenever it has a
  valid in-range target, and holds fire otherwise.
- **Every damage component carries a targeting priority**, chosen by the player and
  changed at any time from the selected-component inspector (`specs/controls.md`).
  Every component **defaults to `first`**. The five priorities:
  - **`first`** — the in-range unit **furthest along** the waypoint chain (the unit
    nearest to grounding out at the collector; progress is measured as waypoint
    index reached, then remaining path length to the next waypoint,
    `specs/board.md`). The default.
  - **`last`** — the in-range unit **least far along** the chain (nearest the entry).
  - **`nearest`** — the in-range unit at the **shortest straight-line distance** from
    the component's own center.
  - **`strongest`** — the in-range unit with the **most remaining hit points**.
  - **`weakest`** — the in-range unit with the **fewest remaining hit points**.
  - Ties resolve toward the unit **furthest along** the chain, so a component's
    choice is deterministic. Changing priority is free and takes effect immediately.
- The **Coil** and the **Arc-Node** pick their **primary** target by this priority
  exactly like the others, then chain / splash **around** that primary (below).
- **Components aim.** A firing component's **head rotates to face the unit it is
  firing at** and keeps its last heading while it holds fire. The sprite is authored
  as a rotatable head over a fixed base, drawn facing one canonical direction so the
  game turns it to aim (`specs/assets.md`).
- **A shot is a real projectile, and the projectile carries the hit.** When a
  component fires it launches a **visible traveling bolt / arc** from its head toward
  the target; the projectile **travels** and applies the damage **on impact** — never
  before. **Hitscan does not satisfy this.** If the target dies or leaves before the
  projectile arrives, the shot **misses**. This travel is where the electrical VFX
  live (`specs/assets.md`).
- Each component's info — in the selected-component inspector (`specs/board.md`) —
  reads its **type**, its **quality tier**, and its live stats (damage, range, fire
  rate, targeting), and all five read as hitting **ground and air**.

## Base (Scrap / T1) stats

These are the **base** numbers every higher tier scales from (per the rules above).

| Type | Range | Fire rate | Base dmg (T1) | Firing behavior |
| --- | --- | --- | --- | --- |
| **Capacitor** | 80 | 1.6 /s | 8 | single target |
| **Coil** | 88 | 1.1 /s | 6 | chains to nearby extra targets (below) |
| **Emitter** | 70 | 4.5 /s | 2 | single target, very fast |
| **Arc-Node** | 78 | 0.9 /s | 7 | splash: all units within radius of impact (below) |
| **Discharge Rig** | 130 | 0.5 /s | 22 | single target, long range |

- **Capacitor** — the cheap, reliable workhorse: one clean bolt at a steady cadence.
  The component you keep active in numbers early and climb by combining.
- **Emitter** — the fastest firer at the lowest per-shot damage; its rate makes it
  the anti-swarm answer, stripping **Sparks** and **Clusters** (`specs/enemies.md`)
  before they cross the yard.
- **Discharge Rig** — the long-range heavy hitter: a big single bolt on a slow
  cadence, the anti-tank sniper that answers the **Slug** and chips the **Dynamo**
  (`specs/enemies.md`).

### Coil — chain-lightning

The Coil's bolt hits its primary target, then **leaps** to the nearest
not-yet-hit unit within **`70 px`** of the last unit struck, and again from there,
forking through the pack. Each leap deals **`×0.7`** of the previous leap's damage
(the primary hit is full damage; the first leap `×0.7`, the second `×0.49`, and so
on), so the chain **dims per jump** — mirror this in the VFX (`specs/assets.md`).
The **maximum number of additional leaps** grows with quality:

| Quality | T1 Scrap | T2 Tuned | T3 Charged | T4 Primed | T5 Tesla-Prime |
| --- | --- | --- | --- | --- | --- |
| **Additional leaps** | 2 | 2 | 3 | 3 | 4 |

A leap that finds no un-hit unit within `70 px` ends the chain early. The Coil is
the natural answer to a tight **Cluster** pack (`specs/enemies.md`).

### Arc-Node — area discharge

The Arc-Node picks a primary target by its priority, and its shot **discharges** at
the impact point, dealing its **full damage to every unit** — ground or flying —
within the splash radius of that point. The radius grows with quality:

| Quality | T1 Scrap | T2 Tuned | T3 Charged | T4 Primed | T5 Tesla-Prime |
| --- | --- | --- | --- | --- | --- |
| **Splash radius (px)** | 45 | 50 | 55 | 60 | 65 |

Splash is **flat full damage** inside the radius (no falloff). With the Coil, the
Arc-Node is the answer to dense packs and the swarming **Cluster** wave
(`specs/enemies.md`). The Capacitor, Emitter, and Discharge Rig deal **single-target**
damage only — no chain, no splash.

## Full damage table (type × quality)

Damage per shot, `base × qualityMult`, rounded — **fixed**:

| Type | Scrap (T1) | Tuned (T2) | Charged (T3) | Primed (T4) | Tesla-Prime (T5) |
| --- | --- | --- | --- | --- | --- |
| **Capacitor** | 8 | 18 | 40 | 88 | 192 |
| **Coil** | 6 | 13 | 30 | 66 | 144 |
| **Emitter** | 2 | 4 | 10 | 22 | 48 |
| **Arc-Node** | 7 | 15 | 35 | 77 | 168 |
| **Discharge Rig** | 22 | 48 | 110 | 242 | 528 |

(For the Coil, this is the **primary-hit** damage; each leap is `×0.7` of the
previous, per above. For the Arc-Node, this is dealt to **every** unit in the
splash radius.)

## Full range table (type × quality)

Range in logical pixels, `base + 2·(tier − 1)` — **fixed**:

| Type | T1 | T2 | T3 | T4 | T5 |
| --- | --- | --- | --- | --- | --- |
| **Capacitor** | 80 | 82 | 84 | 86 | 88 |
| **Coil** | 88 | 90 | 92 | 94 | 96 |
| **Emitter** | 70 | 72 | 74 | 76 | 78 |
| **Arc-Node** | 78 | 80 | 82 | 84 | 86 |
| **Discharge Rig** | 130 | 132 | 134 | 136 | 138 |

## Cost, invested value, and selling

A component is created only by **stamping the press** or by **combining**
(`specs/build.md`); it is never bought at a chosen quality. Its worth is the Charge
that made it — its **invested value** — and that governs what selling refunds.

- A **stamp** costs **18 Charge** and yields one component, so a stamped component's
  invested value is **18**. A **combined** component is worth the **sum of the two
  it consumed** (combining costs no Charge), so invested value **doubles each combine
  rung**.
- **Selling** an active component refunds **70% of its invested value**, rounded
  down; selling frees its 2×2 footprint immediately and the floor re-paths
  (`specs/board.md`).
- **Slagging** an active component (converting it to an inert **slag wall**,
  `specs/build.md`) refunds a flat **12 Charge**; a **slag wall** itself sells for
  **6**.
- **Full-refund window:** a component stamped, kept, or slagged during a build phase
  and sold **before that wave starts** refunds its **full** invested value, no 70%
  loss — this makes the opening build fully re-shapeable (`specs/build.md`,
  `specs/flow.md`).

| Quality | Invested value | Sell (70%, active) |
| --- | --- | --- |
| **T1 Scrap** | 18 | 12 |
| **T2 Tuned** | 36 | 25 |
| **T3 Charged** | 72 | 50 |
| **T4 Primed** | 144 | 100 |
| **T5 Tesla-Prime** | 288 | 201 |

The steep damage curve against this doubling invested value is why **combining
always pays**: two matching components fold into one that out-damages them both and
frees a tile, so the only question is whether you can give up that wall's position
in the maze (`specs/build.md`, `specs/board.md`). Stamping, slagging, combining,
selling, and setting targeting all happen through the selected-component inspector
and the scrap-press in the build panel (`specs/controls.md`).
