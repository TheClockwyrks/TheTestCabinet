# Fathom — The Lanternjaw

The Lanternjaw hunts the forager's light. This file defines its sense, its two speeds,
its tell, and the states it moves between. What every predator shares is
in `specs/predators.md`. Every figure below carries the name this specification gives
it.

## Sense: light, in a straight line

The Lanternjaw senses the forager on any step where all three of these hold at once.

| The condition    | What it means                                                                          |
| ---------------- | -------------------------------------------------------------------------------------- |
| In range         | The distance between the two centers is at most `R`, the Lanternjaw's detection range. |
| In line of sight | The straight line between the two centers crosses no rock tile.                        |
| Clear of ink     | That same line crosses no ink cloud, and the Lanternjaw itself stands in none.         |

`R` grows with the forager's brightness `G`:
`R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`, with `LANTERN_RANGE_BASE` (`128`)
and `LANTERN_RANGE_GAIN` (`192`) in logical units. So `R` is `128` (4 tiles) at
`G = 0`, `320` (10 tiles) at `G = 1`, and rises smoothly between the two. The snapshot
reports its current value as `detectRange`, and the Lanternjaw reports `hearingRange`,
`hearingLock`, `flareCharging`, `flaring` and `flareRadius` as `null`.

While it senses the forager, its fix is the forager's current tile, refreshed every
step, and it reports `state` as `"chase"`.

## Losing the forager

When the sense lapses because the forager rounded a corner, dimmed out of range, or
moved beyond `R`, the fix holds at the last tile the Lanternjaw sensed the forager on.
It keeps `state` `"chase"`, paths to that tile, and holds there for `LINGER_TIME`
(`2 s`) from the moment the sense lapsed. Sensing the forager again at any point in
that window resumes an ordinary chase, and the fix follows the forager once more,
without a fresh alert. When the window runs out with nothing sensed, the Lanternjaw
drops the fix and returns to `"wander"`.

Ink is the exception, and it is immediate. An ink cloud that the Lanternjaw stands in,
or that lies on the line between it and the forager, drops the fix at once, with no
linger, and the Lanternjaw wanders for as long as the cloud blinds it.

## Speeds

| While it is | It travels at, in logical units per second       |
| ----------- | ------------------------------------------------ |
| Wandering   | `DRIFTER_SPEED` (`64`), the bonus drifter's pace |
| Chasing     | `PREDATOR_SPEED` (`116`)                         |

Wandering it also takes the drifter's routing, choosing among the open directions at
each junction exactly as a drifter does, so an undetected Lanternjaw drifts the
corridors at a drifter's speed and on a drifter's path. The instant it takes a fix it
drops the disguise and hunts at `PREDATOR_SPEED`, which is below the forager's own
speed.

## The tell: the always-visible bulb

The Lanternjaw carries a bulb, a single glowing amber point drawn at the creature's
center. The bulb is one of the amber lights of the maze, shown under the amber-light
rule `specs/sensing.md` fixes, so it shows in the dark even while the Lanternjaw's
body is unlit and its tile is unrevealed. The Lanternjaw fires no detection alert, and
the bulb is its standing tell.

The bulb is drawn identically to the bonus drifter's: the same amber glow at the same
place on the body, and the same amber bell on the sprite. While it wanders, the
Lanternjaw's body is the jellyfish disguise `specs/assets.md` lays out, the same art
the drifter is drawn from, so at a glance an amber glimmer in the dark could be either.
A reveal is additive: when the forager's light or a flare falls on the creature, the
bulb neither moves nor changes, and only what hangs beneath it tells the two apart.

A sonar pulse never resolves that question. The Lanternjaw is an amber-light entity, so
a pulse that floods over it leaves the bulb exactly as it was and draws no body,
marking neither it nor a drifter, as `specs/sensing.md` states.

## States

| From       | To         | When                                                          |
| ---------- | ---------- | ------------------------------------------------------------- |
| `"den"`    | `"wander"` | It has swum out of the den chamber after its release time.    |
| `"wander"` | `"chase"`  | Its sense holds the forager.                                  |
| `"chase"`  | `"chase"`  | Its sense holds the forager, or the linger is still running.  |
| `"chase"`  | `"wander"` | `LINGER_TIME` runs out with nothing sensed, or ink blinds it. |

The Lanternjaw never reports `state` as `"search"`.
