# Wireworm — Scoring

A run carries one running score, starting at `0`. This file states every figure
it is paid and the bonus life it earns. The score is shown in the HUD and on the
end screens, as `specs/ui.md` states.

## What scores

| Event | Constant | Figure |
| --- | --- | --- |
| A bolt destroys a worm's head. | `SCORE_HEAD` | `100` |
| A bolt destroys any other worm segment. | `SCORE_BODY` | `10` |
| A discharge destroys a worm segment. | `SCORE_FRY` | `10` |
| A discharge removes a node. | `SCORE_PURGE_NODE` | `5` |
| A bolt removes an inert node. | `SCORE_INERT_NODE` | `1` |
| A glitch is destroyed. | `SCORE_GLITCH` | `300` |
| A dropper is destroyed. | `SCORE_DROPPER` | `200` |
| A corruptor is destroyed. | `SCORE_CORRUPTOR` | `1000` |
| A level is cleared. | `SCORE_LEVEL_CLEAR` | `100 * level`, for the level just cleared |
| The run is won. | `SCORE_VICTORY` | `250 * lives`, for the lives remaining |

Each figure is paid once, on the event itself. `SCORE_FRY` is paid for every
segment a discharge destroys, whatever its place in the chain, and
`SCORE_PURGE_NODE` for every node a discharge removes, the node the bolt
detonated included. A foe's bounty is paid on the bolt that destroys it, so the
first bolt into a dropper pays nothing and the second pays `SCORE_DROPPER`. The
victory bonus is paid on top of level `12`'s clear bonus.

Nothing else scores. A bolt that knocks a node's charge down one level pays
nothing, a bolt that resolves against nothing pays nothing, and a node laid by a
dropper or a node lost to a glitch pays nothing.

## The bonus life

One extra life is granted each time the score crosses a multiple of
`BONUS_LIFE_EVERY` (`12,000`) through play. A single award that carries the score
across more than one multiple grants one life for each multiple crossed.
