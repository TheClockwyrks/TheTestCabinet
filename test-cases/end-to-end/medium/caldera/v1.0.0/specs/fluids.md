# Caldera — The fluid network: water, steam, and power

This file defines the **flow-network simulation** at the heart of Caldera: how
**water** is drawn and moved, how **boilers** turn it into **steam**, how steam
**powers towers**, the capacities and flow rates, the **elevation-aware** flow
rules, and what happens when supply falls short or a line is cut. The structures
themselves and their costs are in `specs/build.md`; the terrain (elevation, rivers,
deep water, vents) is in `specs/world.md`; towers' combat is in `specs/towers.md`.
Flow is measured in abstract **flow units per second (`f/s`)**; values are
best-effort defaults and **tunable**, but the **relationships** between them are the
requirement.

## The supply chain, end to end

Power flows along one production line, in two fluids:

```
water source ──water pipe──▶ boiler ──steam pipe──▶ tower
(River Tap / Pump)          (on a vent)            (fires only when supplied)
```

- **Sources** draw **water** from the terrain and push it into connected **water
  pipes**.
- **Boilers**, built on vents, pull water in through connected water pipes and emit
  **steam** into connected steam pipes.
- **Towers** pull **steam** through connected steam pipes; a tower fires only while
  its **steam demand** is met (below).

Water and steam are **separate networks** carried by **separate pipe types**
(`specs/build.md`) — a water pipe never carries steam and vice versa. A structure
connects to a pipe of the matching fluid on an edge-adjacent cell across a
flat/terraced edge (never a cliff — `specs/world.md`).

The whole network must be simulated **continuously and frame-rate-independently**
(`specs/overview.md`): flow is a rate, not a per-frame event, and the picture
re-solves as structures are built, destroyed, or severed.

## Water sources and flow

Two sources draw water, at different rates and with different reach:

| Source | Built on | Output | Lift |
| --- | --- | --- | --- |
| **River Tap** | a river cell | **`4 f/s`** (low flow) | **gravity only** — see below |
| **Pump** | beside deep water | **`12 f/s`** (high flow) | **powered lift** — see below |

### Elevation-aware flow — the central puzzle

Water does not move uphill for free. Because vents sit **high** and water sits
**low** (`specs/world.md`), getting water to a boiler is an elevation problem:

- **Gravity (River Tap).** A River Tap is **gravity-fed**: it can deliver water only
  to structures at an elevation **at or below** the tap's own cell. It **cannot**
  push water uphill at all. A tap high on a river can feed a boiler below it; a tap
  in the low channel cannot reach a rim vent.
- **Lift (Pump).** A Pump actively **lifts** water and can deliver to **any**
  elevation, but its deliverable flow **drops with the net rise** from the pump to
  the boiler it feeds: it loses about **`1.5 f/s` per elevation level climbed**
  (down to a floor of `0`). Lifting `0` levels delivers the full `12 f/s`; lifting
  `6` levels delivers about `12 − 9 = 3 f/s`. So a pump placed as **high** as the
  terrain allows, minimizing the climb to the vents, delivers far more than one
  down at the shore feeding a rim boiler.
- **Steam is easy.** Steam is pressurized/buoyant and flows to towers **regardless
  of elevation**, with only a mild distance loss (below). The elevation puzzle is on
  the **water** half of the chain, by design.

This is the core of why the terrain matters to the economy: the layout of low water,
high vents, and the cliffs between them decides where a pump can reach a boiler with
enough flow, and how far the steam must then travel back down to the towers.

## Pipes and capacity

Pipes carry flow but have a finite **throughput capacity** per cell:

- **Water pipe:** capacity **`12 f/s`** per cell.
- **Steam pipe:** capacity **`10 f/s`** per cell.

Flow along a path is limited by the **smallest capacity** on it (and by the source
and demand at its ends). A single pump's `12 f/s` fills a water pipe to capacity; to
carry more, run **parallel** pipe paths. A pipe carrying flow is drawn "live" (a
subtle animated flow in the pipe color, `specs/overview.md`); an unpowered or
starved pipe is drawn dim.

**Steam distance loss.** Steam loses about **`0.5 f/s` for every `5` cells** of pipe
between a boiler and the tower it feeds (tunable), so a tower fed from a distant
boiler gets less than one fed from a near boiler — another reason to distribute
boilers, not centralize them.

## Boilers — water into steam

A **Boiler** (on a vent, `specs/build.md`) is the converter:

- It pulls up to **`8 f/s` of water** in from connected water pipes and converts it
  to **steam** at a ratio of **`0.75`** — up to `8 f/s` water → up to **`6 f/s`
  steam** out, emitted into connected steam pipes.
- Its steam output scales with the water it actually receives: a boiler fed only
  `4 f/s` of water makes about `3 f/s` of steam. A boiler with **no** water makes
  **no** steam (the vent's heat is free; the water is the limiter).
- One boiler per vent; the number of vents caps total steam (`specs/world.md`).

## Towers — steam demand and brownout

A **tower fires only while its steam demand is met.** Each tower has a steam demand
in `f/s` (`specs/towers.md`; e.g. Repeater `2`, Mortar `3`, Lance `5`, Scald `5`,
rising with upgrades). Summed across the towers on a steam network, demand is met
from the steam the boilers on that network produce and deliver:

- **Supplied ≥ demand:** every tower on the network is **powered** and fires
  normally.
- **Supplied < demand (a brownout):** the network is **over-subscribed**. Towers
  **shed** in a defined order until demand fits supply: power the **cheapest-demand
  towers first** (so the most towers stay lit), leaving the highest-demand towers
  **dark** (not firing) until supply recovers. A dark tower is drawn without its
  steam plume and marked on the HUD/overlay (`specs/flow.md`). (You may choose a
  clear, deterministic shed order; "lowest demand first, then nearest the Core" is a
  reasonable default — the requirement is that a brownout is **legible and stable**,
  not thrashing on and off frame to frame.)

The player reads all of this through the **fluid-network overlay** (`specs/flow.md`):
water and steam flow and direction, each source's and boiler's rate, and each
tower's powered / brownout / dark state, with over-subscribed segments and severed
lines flagged. A quick **steam produced-vs-demanded** readout is also on the main HUD.

## Severed lines — the network under attack

The network is a **defended asset**, not set-and-forget. Slag **Sappers** (and
incidental damage from other Slag) destroy pipes and structures (`specs/enemies.md`):

- A **destroyed pipe cell breaks the line**: everything downstream of the break
  loses the flow that ran through it. A cut **water main** starves the boilers it
  fed, which stop making steam, which **browns out** the towers that steam powered —
  a single sapper on a trunk line can darken a whole flank. The overlay flags the
  break.
- Flow **re-solves immediately** when a line is cut or a structure destroyed, and
  again when you **repair** or **re-route** (`specs/build.md`). Keeping trunk lines
  defended, or running redundant paths so one cut does not black out a flank, is part
  of the game.
- A destroyed **source** or **boiler** removes its contribution entirely until
  rebuilt.

## Summary of default rates (all tunable)

| Quantity | Value |
| --- | --- |
| River Tap output | `4 f/s` water (gravity-fed, no uphill) |
| Pump output | `12 f/s` water, `−1.5 f/s` per level lifted (floor `0`) |
| Water pipe capacity | `12 f/s` per cell |
| Steam pipe capacity | `10 f/s` per cell |
| Boiler | ≤ `8 f/s` water → ≤ `6 f/s` steam (ratio `0.75`) |
| Steam distance loss | `−0.5 f/s` per `5` cells |
| Tower steam demand | `2`–`5 f/s` base, rising with upgrades (`specs/towers.md`) |

Tune the numbers freely; keep the **relationships**: rivers are weak and gravity-
bound, pumps are strong but pay for lift, steam is elevation-free but distance-lossy,
boilers gate steam on water, towers gate firing on steam, and a cut line propagates
downstream.
