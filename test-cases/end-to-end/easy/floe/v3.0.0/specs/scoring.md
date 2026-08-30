# Floe — Scoring

This file fixes every score figure. A single score accumulates across the whole
run and is shown in the HUD and on both end screens.

## The awards

| Award | Figure | Paid when |
| --- | --- | --- |
| A newly reached row | `SCORE_ROW` (`10`) | An accepted hop takes the critter to a row above every row it has reached this crossing, which is any hop that lowers `bestRow`. The bay row counts like any other. |
| A filled bay | `SCORE_BAY` (`50`) | A crossing ends in an open bay. |
| The time bonus | `SCORE_TIME_BONUS` (`2`) per whole second | A crossing ends in an open bay, paid `floor(timer)` times over. |
| The bonus catch | `SCORE_BONUS_CATCH` (`200`) | A crossing ends in the bay the bonus catch is in. |
| A cleared level | `SCORE_LEVEL` (`100`) times the level | The level's last open bay is filled. |
| Victory | `SCORE_VICTORY_LIFE` (`250`) per remaining life | The run is won. |

Nothing else scores. A hop that is refused, a hop to a row already reached this
crossing, and a life lost all add nothing.

## The completing hop

A hop that ends a crossing pays the row award, the bay award, and the time bonus
together, so a crossing completed with `T` whole seconds left on the timer pays
`10 + 50 + 2 * T` for that hop. Ending the crossing in the bay holding the bonus
catch pays `SCORE_BONUS_CATCH` on top of that, and filling the level's last bay
pays `SCORE_LEVEL * level` on top again. Winning the run pays
`SCORE_VICTORY_LIFE * lives` after the level award.

## What the score does

The score sets the pace of the bonus lives `specs/progression.md` fixes, and
beyond that it changes nothing: the crossing timer, the level, and the strait's
lanes are the same whatever the score reads. It is not persisted between
sessions.
