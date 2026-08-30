# Arc Foundry — Charge and Grid Integrity

A run carries two resources: Charge, the currency spent on refinement and on combination
towers, and Grid Integrity, the counter a leak drains and defeat empties. This file fixes
both. Every value in it is the same at every difficulty.

## Charge

The run opens with `START_CHARGE` (`10`) Charge. Charge is scarce by design: bounties are
small, the wave-clear bonus is small, and Charge never accrues interest.

### Income

| Source | Amount |
| --- | --- |
| Kill bounty | The killed unit's bounty from `specs/enemies.md`, paid the instant it is removed. |
| Wave-clear bonus | `WAVE_BONUS_BASE + WAVE_BONUS_STEP * waveNumber`, with `WAVE_BONUS_BASE` (`8`) and `WAVE_BONUS_STEP` (`2`). Wave `1` therefore pays `10`. |

The wave-clear bonus is a function of the wave number and of nothing else. It does not
scale with how many units the wave held, with how many of them the player killed, or with
how much Charge the player has banked. It is paid when the wave clears, which is when
every unit the wave released has died or leaked.

There is no other income. Charge does not accrue interest.

### Spending

Charge is spent on exactly two things.

| Sink | Cost |
| --- | --- |
| Refining the press | `REFINEMENT_COSTS`, in `specs/scrap-press.md`. |
| Upgrading a combination tower | A fraction of the tower's reference damage, in `specs/combinations.md`. |

Stamping a rock, keeping, downgrading, combining, dismantling, and changing a targeting
priority all cost nothing.

There is no selling. Nothing placed is ever refunded for Charge, and dismantling a
structure returns nothing.

## Grid Integrity

The run opens with `START_INTEGRITY` (`20`) Grid Integrity.

- A unit that reaches the collector grounds out, costs its leak value in Grid Integrity,
  and is removed. Leak values are in `specs/enemies.md`: most units `1`, a Slug `2`, and
  a Dynamo `5`.
- Grid Integrity never regenerates.
- Grid Integrity reaching `0` or below ends the run in defeat immediately, even mid-wave.

Grid Integrity decides win and loss and nothing else. The run's only end-of-run figure is
the Maze Rating of `specs/campaign.md`.
