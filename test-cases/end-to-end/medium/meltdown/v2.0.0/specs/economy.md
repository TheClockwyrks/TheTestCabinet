# Meltdown — The economy

Money is what gates how fast a maze can grow, and the score is what an end screen
reports. This file defines every figure of both. What money buys is in
`specs/building.md`, and each unit's bounty is in `specs/surge.md`.

## Money

A run opens on the starting money its mode and difficulty give it, as
`specs/modes.md` states.

Money is spent on building a tower and on upgrading one, and selling one pays its
refund back. Money never falls below `0`: a purchase the money on hand cannot
cover does not happen at all, and nothing about the floor or the run changes when
one is refused.

## The four income lines

| Line             | What it pays                                                                                         | When                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Bounty           | The killed unit's bounty                                                                             | On the frame a unit's hp reaches `0`    |
| Wave-clear bonus | `WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * w`, which is `20 + 5w` for wave `w`                         | On the frame wave `w` clears            |
| Interest         | `min(floor(INTEREST_RATE * money), INTEREST_CAP)`, which is `floor(0.08 * money)` capped at `40`     | On entering a build phase between waves |
| Early-send bonus | `EARLY_SEND_PER_SECOND` (`1`) per whole second left on the build timer, which is `floor(buildTimer)` | On sending a wave from a build phase    |

A unit that reaches its exhaust pays no bounty.

Interest is computed after the wave-clear bonus of the same transition has landed,
so the percentage is taken on the money that bonus left. It is paid only on
entering a build phase between waves: entering the opening phase pays none, and a
mode whose `interest` reads false pays none at all.

The early-send bonus is paid on sending from a build phase alone. Sending from
the untimed opening phase, which carries no timer, pays nothing.

## Score

A score accumulates across a run and is reported on the end screens. It has three
terms:

| Term           | Value                                                               |
| -------------- | ------------------------------------------------------------------- |
| A kill         | The killed unit's bounty, the same figure the money is paid         |
| A wave cleared | `SCORE_WAVE_CLEAR * w`, which is `100 * w` for wave `w`             |
| Victory        | `SCORE_VICTORY_PER_LIFE * lives`, which is `250` per life remaining |

The score changes nothing about play and is not carried between sessions.
