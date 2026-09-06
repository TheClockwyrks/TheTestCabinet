# Arc Foundry — The Load

The Load is the runaway surge the player defends against. This file fixes its roster, the
status effects a unit can carry, how a unit's health grows as the waves deepen, the
invincible boss that runs the finale, and the rules a wave's composition obeys. How a
unit crosses the yard is in `specs/pathing.md`, and what a leak costs is in
`specs/economy.md`.

Speeds are in logical units per second. Health, bounty, and leak are unitless game
values.

## Shared rules

- Every unit spawns at the map's entry, walks or flies the ordered chain, and grounds out
  at the collector, where it is removed.
- A unit that grounds out leaks, costing the player its leak value in Grid Integrity.
- A killed unit pays its bounty in Charge the instant it dies.
- Each unit carries a health bar above it that depletes as it takes damage.
- Every firing component hits ground and flying units alike. There is no armor and no
  damage type: a shot removes health from any unit, and no unit resists or is immune.
- Only health scales across waves. Speeds, bounties, and leak values are constant for the
  whole run.

## The roster

`LOAD_ROSTER` holds the six unit types. The health figures below are the base values the
per-wave scaling multiplies.

| Type     | Base health | Speed | Flies | Bounty | Leak |
| -------- | ----------- | ----- | ----- | ------ | ---- |
| Mote     | `44`        | `60`  | No    | `1`    | `1`  |
| Spark    | `27`        | `120` | No    | `1`    | `1`  |
| Slug     | `180`       | `38`  | No    | `3`    | `2`  |
| Cluster  | `16`        | `72`  | No    | `1`    | `1`  |
| Filament | `74`        | `85`  | Yes   | `2`    | `1`  |
| Dynamo   | `1500`      | `30`  | No    | `40`   | `5`  |

| Type     | What it is                                                                       |
| -------- | -------------------------------------------------------------------------------- |
| Mote     | The baseline charge unit.                                                        |
| Spark    | Roughly half a Mote's health at double its speed.                                |
| Slug     | A slow unit with a large health pool that costs `2` Grid Integrity on a leak.    |
| Cluster  | Very low health, released in tight packs.                                        |
| Filament | The flyer. It ignores the maze and flies the straight-line chain.                |
| Dynamo   | The boss. It reads as an unstable overload core and anchors the milestone waves. |

## Status effects

A unit can carry a slow and a burn at the same time. Neither blocks a shot; each only
changes the unit's speed or removes health over time. `specs/components.md` fixes which
components apply them and with what amounts.

### Slow

A slow carries an amount `amt` and a duration. Applying a slow of amount `amt` at time
`now` for `dur` seconds sets:

```
slowFactor = min(slowFactor, 1 - amt)
slowUntil  = now + dur
```

While `now < slowUntil` the unit moves at `baseSpeed * slowFactor`. Once `slowUntil`
passes, `slowFactor` returns to `1`. Slows do not stack: the strongest slow in effect
wins, and a fresh hit refreshes the duration.

### Burn

A burn carries a damage-per-second figure and a duration. Applying a burn of `dps` at
time `now` for `dur` seconds sets:

```
burnDps   = max(burnDps, dps)
burnUntil = now + dur
```

While `now < burnUntil` the unit loses `burnDps` health per second, integrated against
the update's delta time. Burns do not stack: the target keeps the strongest `burnDps` and
a fresh hit refreshes the duration. Burn damage is credited to the component that applied
it, for that component's kill and damage tallies.

## Per-wave health scaling

A unit's maximum health on wave `w` is:

```
HP(w) = round( baseHP * baseMult * [ (1 + k * (w - 1)) + c * (r^(w - 1) - 1) ] )
```

- `baseHP` is the unit's base health from the roster.
- `baseMult`, `k`, `c`, and `r` are the chosen difficulty's constants, in
  `specs/difficulty.md`. They are the only thing difficulty changes about a unit.
- A unit's maximum health is a whole number. The bracketed product is a real number and
  it is rounded to the nearest integer, with an exact half rounding up.
- The bracket carries a linear ramp `(1 + k * (w - 1))` and an exponential surcharge
  `c * (r^(w - 1) - 1)`. The surcharge is exactly `0` at wave `1`.
- Waves are numbered `1` through `N`, so the formula is defined from `w = 1` and wave
  `1`'s figure is the lowest health any unit of a type ever carries.

At wave `1` the formula yields `round(baseHP * baseMult)`. On Medium, whose `baseMult` is
`0.22`, a Mote's `44 * 0.22 = 9.68` is `10` health and a Filament's `74 * 0.22 = 16.28`
is `16`.

## The Overload Dynamo

After the final wave is cleared, one Overload Dynamo runs the finale of
`specs/campaign.md`. It is a unit of its own, distinct from the Dynamo boss.

- It spawns at the entry and walks the chain to the collector exactly as any ground unit
  does, taking the open route of least length, and at a speed of `55`.
- It cannot be killed. It carries no depleting health bar, and every point of damage
  dealt to it, direct hits and burn ticks alike, is tallied into the run's Maze Rating
  instead of removing health. Its health never falls.
- It takes slow and burn like any other unit.
- Grounding out at the collector costs no Grid Integrity.
- It reads on the yard as an oversized, roiling overload core.

## Wave composition

A wave is a timed sequence of units released from the entry. The per-wave mix and the
spawn timing within a wave are yours to design, subject to the rules below and to the
progression of `specs/campaign.md`. A run's wave count `N` comes from the chosen
difficulty.

A wave's composition is settled when the wave begins. The sequence of releases is fixed
at that moment and the wave releases exactly that sequence, so what the wave will carry is
knowable from its first frame — which is what the next-wave preview of `specs/hud.md`
draws and what `specs/instrumentation.md`'s `waveCount` reads.

| Rule             | Requirement                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Air cadence      | A wave whose number is a multiple of `4` carries Filaments. No other wave carries a Filament. |
| Milestone bosses | Wave `round(N / 2)` and wave `N` each carry exactly one Dynamo. No other wave carries one.    |
| Opening waves    | Waves `1` through `3` carry Motes and Sparks only.                                            |
| Cluster and Slug | Neither appears before wave `5`.                                                              |
| Growth           | A wave's total health pool is at least that of the wave before it.                            |

Beyond those rules, compose waves so that no single component type answers everything:
Sparks reward coverage near the entry, Slugs reward concentrated single hits, Clusters
reward splash and chain, Filaments reward coverage under the straight-line flight path,
and a Dynamo rewards raw output.
