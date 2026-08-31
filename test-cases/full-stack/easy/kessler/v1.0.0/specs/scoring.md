# Kessler — Scoring

This file fixes every point the game awards and the event each award rides on.
The hits, destructions, and the clearing event are in `specs/rings.md`, pierce
and the pod catch are in `specs/pods.md`, and the readouts that show the score
are in `specs/screens.md`.

## The score

A fresh session starts the score at `0`, and the score changes only by the
awards below. Each award lands on the tick its event resolves, and the score's
readout shows the new value on that same tick rather than counting up toward
it.

## The awards

| Event | Points |
| --- | --- |
| A hit that leaves the target alive | `50` |
| Destroying a ring 1 target | `100` |
| Destroying a ring 2 target | `200` |
| Destroying a ring 3 target | `300` |
| Catching a salvage pod | `25` |
| The clearing event on wave `w` | `500 * w` |

A face hit and an edge hit award alike, and a hit awards exactly one row: the
`50` while the target survives, its ring's destroy figure when it destroys. A
piercing ball's contact destroys outright, so it awards the destroy figure
alone. Every pod catch awards the `25`, a `shield` pod caught while a shield
is active and a `multiball` pod caught at the ball cap included.

The clearing event's bonus is `500` times the number of the wave just cleared,
so clearing wave `1` awards `500` and clearing wave `3` awards `1500`. The
destruction that clears the wave awards its own destroy figure and the bonus
on the same tick.
