# Meltdown — The towers: the roster, stats, upgrades, and building

This file defines the eight towers — six **emitters** that fire and the two
**movers** (Forge and Vent) that only shift heat — their stats and thermal
personalities, and how you build, upgrade, and sell them. It builds on the floor
in `specs/playfield.md`, the heat system in `specs/heat.md`, the controls in
`specs/controls.md`, and the economy in `specs/flow.md`. Ranges are in **tiles**
(one tile = `40 px`, `specs/playfield.md`); heat figures use the `0..100` scale
of `specs/heat.md`.

The stat numbers below are the **starting balance** for this version. They are
meant to be tuned by play; implement them as written, but structure the code so
the values are easy to adjust. What must be exactly right is the **behavior**:
the heat-to-damage curve, the redline trip, the coupling, and each tower's
stance.

## Targeting, shared rules

- An emitter automatically fires at surge units **in range** — there is no
  manual trigger. Range is a radius in tiles measured from the tower's tile
  center; a unit within that radius is targetable.
- By default an emitter targets the in-range unit **furthest along its path** to
  an exhaust (the standard "first" target). Splash and anti-air differ as noted.
- Each emitter fires at its **fire rate** (shots/second) whenever it has a
  target, adding `heatPerShot` per shot and dealing `baseDamage *
  heatMultiplier(H)` per shot (`specs/heat.md`). With no target it only cools.
- **Ground emitters cannot hit flyers**; only the **Flak** can (see
  `specs/creeps.md`). The Forge and Vent never target anything.

## The six emitters

| Tower | Role / stance | Cost | Range | Fire rate | Base dmg | heatPerShot | coolRate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Arc** | Basic, balanced — heat-hungry, wide sweet spot | 90 | 3.0 | 1.5 /s | 11 | 12 | 12 /s |
| **Stutter** | Rapid fire, low per-shot — heat-hungry, trips easily | 140 | 2.5 | 6.0 /s | 3 | 4 | 12 /s |
| **Lance** | Long-range sniper, slow heavy shot — heat-hungry, runs cold | 210 | 6.0 | 0.5 /s | 75 | 40 | 9 /s |
| **Bloom** | Area splash — heat-hungry, heavy heat per shot | 240 | 3.0 | 0.9 /s | 16 | 24 | 12 /s |
| **Rime** | Cryo slow — **heat-averse** | 150 | 2.75 | 1.2 /s | 4 | 9 | 12 /s |
| **Flak** | Anti-air (and ground) — heat-hungry, the only flyer counter | 170 | 4.0 | 2.0 /s | 9 | 8 | 12 /s |

Notes on the ones with special behavior:

- **Arc** is the workhorse. Its firing heat (`1.5 * 12 = 18`/s) outpaces its
  cooling (`12`/s) only modestly, so in a steady lane it warms to a strong
  middle of the curve and rarely trips on its own — forgiving, the tower to
  learn on.
- **Stutter** pours on heat (`6 * 4 = 24`/s vs. `12`/s cooling) and **climbs to
  the redline fast** in any busy lane, then trips for `3 s`. On its own it is a
  stuttering gun that keeps cutting out; **beside a Vent** it can hold a
  continuous stream of fire. It is the clearest "wants a Vent" tower.
- **Lance** fires once every two seconds for a huge hit, and because its targets
  are usually sparse at its long range it tends to **run cold and hit near its
  `1.0x` floor** — wasting most of its potential. **Beside a Forge** it stays
  warm between shots and lands far harder. It is the clearest "wants a Forge"
  tower.
- **Bloom** damages **all** surge units within **`1.2` tiles** of its shot's
  impact (it targets the in-range unit furthest along, and splashes around it).
  Its big `heatPerShot` means a Bloom in a packed chokepoint heats quickly.
- **Flak** is the **only** tower that can target **flyers** (`specs/creeps.md`);
  it can also hit ground units. It prefers an in-range **flyer** when one is
  present, else the furthest-along ground unit. Without at least one Flak,
  flyers cross the floor untouched.

### Rime — the heat-averse emitter

The **Rime** does not deal meaningful damage; it **slows** the surge, and —
unlike every other emitter — it works **best cold**. Its slow strength falls as
it heats:

```
slowFactor(H) = 0.55 * (1 - H / 100)
```

A hit applies a movement **slow** of `slowFactor(H)` (a fraction of normal speed
removed) for **`1.5 s`**, refreshed by further hits, and slows do not stack
beyond the strongest currently applied. So a **cold** Rime (`H ≈ 0`) cuts a
unit's speed by up to **`55%`**; a Rime run hot does almost nothing — at `H =
100` its slow is `0`. Its own firing heats it slowly (`1.2 * 9 = 10.8`/s vs.
`12`/s cooling), so on its own it stays near cold; the danger is **external**
heat. **Keep a Rime cold**: isolate it, or place a **Vent** beside it, and keep
**Forges** and hot cores away — a Rime sitting next to a Forge is a Rime that
has stopped slowing. Some surge units are **immune to slowing** entirely
(`specs/creeps.md`); a Rime does nothing to those regardless of its heat.

A Rime still **trips** at the redline like any emitter (`specs/heat.md`), but a
Rime hot enough to be near the redline was already useless — the heat-averse
curve punishes you long before the trip does.

## The two movers — Forge and Vent

The **Forge** and **Vent** never fire and have no heat of their own; they shift
heat to and from their **four orthogonally adjacent** emitters every second (see
Thermal coupling in `specs/heat.md`).

| Tower | Effect on each orthogonal emitter | Cost |
| --- | --- | --- |
| **Forge** | **+18** heat/second (continuous) | 70 |
| **Vent** | **-22** heat/second (continuous) | 70 |

- A **Forge** adds `18`/s to each adjacent emitter's heat — enough to keep a
  Lance warm in a lull, or enough to push a Stutter that is already firing into
  the redline. Use it to wake cold guns; keep it away from anything you need to
  stay cool.
- A **Vent** removes `22`/s from each adjacent emitter's heat — enough to keep a
  Stutter firing continuously without tripping, or to hold a packed core just
  under the redline at maximum damage. Use it to brake your hot guns and to
  shield a Rime from stray heat.

Both are still **walls** like any tower (`specs/playfield.md`), so they also
shape the maze. Multiple Forges/Vents adjacent to one emitter **stack** their
effect.

## Building, upgrading, and selling

- **Build.** Buy a tower from the shop and place it on an open tile
  (`specs/controls.md`). Its **cost** (above) is deducted from your money
  (`specs/flow.md`); you cannot build what you cannot afford. Placement obeys
  the mazing rules in `specs/playfield.md` (never seal the floor).
- **Upgrade.** A selected tower can be upgraded through **three levels** — **I**
  (as built), **II**, and **III**. Each upgrade improves the tower and, for
  emitters, makes it run **hotter** — a maxed emitter is a glass cannon that
  needs thermal support. Each level applies, on top of the previous level's
  stats:
  - **Emitters:** `baseDamage * 1.6`, `range + 0.5` tiles, `fireRate * 1.15`,
    and `heatPerShot * 1.3` (it heats faster; `coolRate` is unchanged). The
    **Rime** instead raises its **cold-slow ceiling** — `0.55 → 0.68 → 0.80` at
    levels I/II/III — and its range and `heatPerShot` like the others; its
    heat-averse curve is otherwise unchanged.
  - **Movers:** the **Forge**'s output and the **Vent**'s draw grow by `+50%`
    per level (Forge `18 → 27 → 36`/s; Vent `22 → 33 → 44`/s); range/footprint
    are unchanged.
  - **Cost.** Upgrading to **II** costs `1.0x` the tower's build cost; to
    **III**, `1.8x` the build cost. (For an Arc: `90` to reach II, `162` to
    reach III.)
- **Sell.** A selected tower can be sold for a **`70%` refund** of everything
  spent on it (build plus upgrades), rounded down. Selling **reopens its tile
  immediately** and the surge re-paths (`specs/playfield.md`). Selling is how
  you re-shape the maze between waves.

Upgrading and selling happen through the selected-tower inspector in the build
panel (`specs/playfield.md`, `specs/controls.md`).
