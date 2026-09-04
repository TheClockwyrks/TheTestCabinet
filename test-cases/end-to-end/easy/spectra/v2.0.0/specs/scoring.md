# Spectra — Scoring

This file defines every figure the game scores. The score accumulates across the
whole run, is shown in the top HUD strip, and is not kept between sessions.

## Destroying a drone

What a destroyed drone pays depends on its kind and on the phase it was in.

| Destroyed | Pays |
| --- | --- |
| A Shard in phase `formation` | `SCORE_SHARD_FORM` (`50`) |
| A Shard in phase `entering`, `diving`, or `returning` | `SCORE_SHARD_DIVE` (`100`) |
| A Flux in phase `formation` | `SCORE_FLUX_FORM` (`80`) |
| A Flux in phase `entering`, `diving`, or `returning` | `SCORE_FLUX_DIVE` (`160`) |
| A Prism's shell, in any phase | `SCORE_PRISM_SHELL` (`100`) |
| A Prism's exposed core, in any phase | `SCORE_PRISM_CORE` (`400`) |
| One drone of a challenge stage | `SCORE_CHALLENGE_DRONE` (`100`) |

A drone destroyed by a discharge wave pays the same as one destroyed by a bullet in
that phase. A Prism the wave destroys whole pays its shell and its core together.

## Bonuses

| Bonus | Paid |
| --- | --- |
| `SCORE_STAGE_CLEAR` (`1000`) | When a standard stage is cleared |
| `SCORE_PERFECT_BONUS` (`10000`) | When every one of a challenge stage's `CHALLENGE_TOTAL` drones was destroyed |

A challenge stage pays no `SCORE_STAGE_CLEAR`. A challenge stage that left one drone
alive pays the per-drone total alone and no `SCORE_PERFECT_BONUS`.

## What pays nothing

Nothing else adds to the score. A shot that destroys no drone pays nothing, and so
does surviving a wave, flipping, absorbing a bullet, or releasing a discharge.
`specs/mode.md` states what a mismatched shot does under the mode this build ships.
