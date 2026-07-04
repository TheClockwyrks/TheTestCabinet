# Towers

## Overview

This file defines the eight towers — six **emitters** that fire and the two
**movers** (Forge and Vent) that only shift heat — their stats and thermal
personalities, and how you build, upgrade, and sell them. It builds on the
floor in `specs/playfield.md`, the heat system in `specs/heat.md`, the controls
in `specs/controls.md`, and the economy in `specs/flow.md`. Ranges are
expressed in tiles (one tile = `20 px`, `specs/playfield.md`); heat figures use
the `0..100` scale of `specs/heat.md`. A tower's `coolRate` is its cooling rate
*at the redline* (`H = 100`); cooling is proportional to heat, so the effective
cooling is `coolRate * (H / 100)` per second (`specs/heat.md`).

The stat numbers below are the starting balance for this version. They are
meant to be tuned by play; implement them as written, but structure the code so
the values are easy to adjust. What must be exactly right is the **behavior**:
the heat-to-damage curve, the redline trip, the coupling, and each tower's
stance.

## Shared Targeting Rules

- An emitter automatically fires at surge units in range — there is no manual
  trigger. A tower's Range is the radius in tiles measured from the center of
  the tower's 2 x 2 footprint; a unit within that radius is targetable.
- By default an emitter targets the in-range unit **furthest along its path** to
  an exhaust (the standard "first" target), whether that unit is ground or
  flying. Splash and anti-air differ as noted.
- Each emitter fires at its fire rate (shots/second) whenever it has a
  target, adding `heatPerShot` per shot and dealing `baseDamage *
  heatMultiplier(H)` per shot (`specs/heat.md`). With no target it only cools.
- The **Arc**, **Stutter**, **Lance**, **Bloom**, and **Rime** can target both
  ground units and flyers. The **Flak** is the exception: it is **air-only** and
  can target flyers but never ground units. The Forge and Vent never target
  anything.

## Emitters

| Tower | Role / stance | Cost | Range | Fire rate | Base dmg | heatPerShot | coolRate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Arc** | Basic, balanced — heat-hungry, wide sweet spot | 80 | 6.0 | 2.0 /s | 6 | 8 | 14 /s |
| **Stutter** | Rapid fire, low per-shot — heat-hungry, trips easily | 110 | 5.0 | 7.0 /s | 2.0 | 3.0 | 13 /s |
| **Lance** | Long-range sniper, slow heavy shot — heat-hungry, runs cold | 160 | 12.0 | 0.8 /s | 43 | 15 | 19 /s |
| **Bloom** | Area splash — heat-hungry, heavy heat per shot | 180 | 6.0 | 1.2 /s | 10 | 14 | 14 /s |
| **Rime** | Cryo slow — heat-averse | 110 | 5.5 | 2.4 /s | 4 | 6.5 | 15 /s |
| **Flak** | Anti-air only — heat-hungry, dedicated flyer counter | 130 | 8.0 | 2.6 /s | 6 | 5.5 | 13 /s |

Notes on the ones with special behavior:

- **Arc** is the workhorse. Its firing heat (`2.0 * 8 = 16`/s) against its
  cooling coefficient (`14`/s at the redline) gives it a ceiling of `H* ≈ 114`,
  so a lone Arc jammed into a saturated lane and firing flat-out climbs past the
  redline and trips; give it breathing room between targets and it settles hot
  but safely short of it. Forgiving, the tower to learn on.
- **Stutter** pours on heat fast (`7 * 3.0 = 21`/s against a `13`/s cooling
  coefficient) for a very high ceiling (`H* ≈ 162`) — it trips the quickest of
  any emitter, redlining even on a moderately busy lane. On its own it is a
  stuttering gun that keeps cutting out; beside a Vent it holds a continuous
  stream of fire. It is the clearest "wants a Vent" tower.
- **Lance** fires about every `1.25 s` (`0.8`/s) for a huge hit, but its firing
  heat is low (`0.8 * 15 = 12`/s against a `19`/s cooling coefficient) for a
  ceiling of only `H* ≈ 63` — so, alone among the emitters, a lone Lance **cannot
  reach the redline on its own**. Its targets are sparse at its long range too,
  so it tends to run cold and hit near its `0.5x` floor — barely half its base
  damage. Beside a Forge it warms up and lands far harder, and a Forge plus
  steady firing is the only thing that can push it past the redline (add a Vent
  to keep it there). It is the clearest "wants a Forge" tower.
- **Bloom** damages **all** surge units within `2.4` tiles of its shot's
  impact (it targets the in-range unit furthest along, and splashes around it).
  Its heavy `heatPerShot` means a Bloom in a packed chokepoint heats quickly.
- **Flak** is the dedicated anti-air tower (`specs/creeps.md`): it can target
  flyers only and ignores ground units entirely. Other emitters can still shoot
  flyers, but they split attention between air and ground by their normal
  targeting rules. Flak is how the player buys reliable air coverage without
  pulling ground damage off the maze.

### Rime

The **Rime** does not deal meaningful damage; it **slows** the surge, and —
unlike every other emitter — it works best cold. Its slow strength falls as
it heats:

```
slowFactor(H) = 0.55 * (1 - H / 100)
```

A hit applies a movement slow of `slowFactor(H)` (a fraction of normal speed
removed) for `1.5 s`, refreshed by further hits, and slows do not stack
beyond the strongest currently applied. So a cold Rime (`H ≈ 0`) cuts a
unit's speed by up to `55%`; a Rime run hot does almost nothing — at `H =
100` its slow is `0`. Its own firing warms it (`2.4 * 6.5 = 15.6`/s against a
`15`/s cooling coefficient → a continuous-fire ceiling `H* ≈ 104`), so a Rime
worked flat-out in a packed lane cooks itself: its slow fades to almost nothing
and it can even climb to the redline and trip. Keep a Rime cold: give it
breathing room, isolate it, or place a Vent beside it, and keep Forges and hot
cores away — a Rime sitting next to a Forge is a Rime that has stopped slowing.
Some surge units are immune to slowing entirely (`specs/creeps.md`); a Rime
does nothing to those regardless of its heat.

A Rime still trips at the redline like any emitter (`specs/heat.md`), but a
Rime hot enough to be near the redline already has negligible slowing.

## Forge and Vent

The **Forge** and **Vent** never fire and have no heat of their own; they shift
heat to and from orthogonally neighboring emitter footprints every second (see
Thermal coupling in `specs/heat.md`).

| Tower | Effect on each fully aligned orthogonal emitter | Cost |
| --- | --- | --- |
| **Forge** | `+12` heat/second (fixed source, continuous) | 60 |
| **Vent** | `+14` to that emitter's `coolRate` (extra cooling, proportional to heat) | 60 |

- A **Forge** adds up to `12`/s of heat to each adjacent emitter — a fixed
  source that raises the emitter's ceiling. Enough to keep a Lance warm in a
  lull, or enough to push a Stutter that is already firing into the redline. Use
  it to wake cold guns; keep it away from anything you need to stay cool.
- A **Vent** adds up to `14` to each adjacent emitter's `coolRate`, so that
  emitter cools by `(coolRate + 14) * (H / 100)` per second — proportional to
  heat, so it bites hardest near the redline and barely touches a cool gun. It
  **lowers the ceiling** (never chills to dead-cold): enough to keep a Stutter
  firing continuously without tripping, or to hold a packed core just under the
  redline at maximum damage. Use it to brake your hot guns and to shield a Rime
  from stray heat. A single Vent is a lever, not immunity — stack a second, or
  upgrade it, to hold a gun that runs hotter (upgraded, or Forge-fed).

Both are still walls like any tower (`specs/playfield.md`), so they also
shape the maze. Multiple Forges/Vents adjacent to one emitter stack their
effect. Apply the alignment scaling from `specs/heat.md`: full edge alignment
uses the table value, and one-tile staggered edge contact uses half the value.

## Building, Upgrading, and Selling

- **Build.** Buy a tower from the shop and place it on an open 2 x 2 footprint
  (`specs/controls.md`). Its cost is deducted from your money
  (`specs/flow.md`); you cannot build what you cannot afford. Placement obeys
  the mazing rules in `specs/playfield.md` (never seal the floor).
- **Upgrade.** A selected tower can be upgraded through three levels — I (base
  level, as built), II, and III. Each upgrade improves the tower and, for
  emitters, makes it run hotter — a maxed emitter is a glass cannon that needs
  thermal support. Each level applies, on top of the previous level's stats:
  - **Emitters:** `baseDamage * 1.6`, `range + 1.0` tiles, `fireRate * 1.15`,
    and `heatPerShot * 1.3` (it heats faster; `coolRate` is unchanged). The
    **Rime** instead raises its cold-slow ceiling — `0.55 → 0.68 → 0.80` at
    levels I/II/III — and its range and `heatPerShot` like the others; its
    heat-averse curve is otherwise unchanged.
  - **Movers:** the **Forge**'s output and the **Vent**'s draw grow by `×1.5`
    per level, on top of the previous level (Forge `12 → 18 → 27`/s; Vent `14 →
    21 → 31.5`/s); range/footprint are unchanged.
  - **Cost.** Upgrading to II costs `1.0x` the tower's build cost; to
    III, `1.8x` the build cost. (For an Arc: `80` to reach II, `144` to
    reach III.)
- **Sell.** A selected tower can be sold for a `70%` refund of everything
  spent on it (build plus upgrades), rounded down. Selling reopens all four
  tiles in its footprint immediately and the surge re-paths
  (`specs/playfield.md`). Selling is how you re-shape the maze between waves.

Upgrading and selling happen through the selected-tower inspector in the build
panel (`specs/playfield.md`, `specs/controls.md`).
