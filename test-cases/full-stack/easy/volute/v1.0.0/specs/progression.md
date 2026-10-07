# Volute — Progression

This file defines the shape of a run: the five levels and the figures each one
fixes, the quota a level delivers, how a level is cleared, the cells a run
spends when a core reaches the intake, and the danger condition. Emission and
the train's advance are in `specs/channel.md`, extraction scoring in
`specs/extraction.md`, the machinery kinds in `specs/machinery.md`, and the
screens and their readouts in `specs/ui.md`.

## Levels

A run plays five levels over the same channel and starts at level 1. Each level
fixes the charges in play, the quota, and the feed speed.

| Level | Charges in play                         | Quota | Feed speed (units/s) |
| ----- | --------------------------------------- | ----- | -------------------- |
| 1     | halide, sulfur, cobalt                  | 45    | 22                   |
| 2     | halide, sulfur, cobalt, garnet          | 55    | 26                   |
| 3     | halide, sulfur, cobalt, garnet          | 65    | 30                   |
| 4     | halide, sulfur, cobalt, garnet, olivine | 75    | 34                   |
| 5     | halide, sulfur, cobalt, garnet, olivine | 90    | 38                   |

The charges in play are the level's charge set, the set every charge draw falls
back to. The feed speed is the level's base rate for the lead segment, before
pressure and machinery scale it. The quota is the total number of cores the
level delivers to the channel, counting the cores standing on it at level
start; the level delivers no further core once the quota is exhausted.

A level begins with the channel seeded as `specs/channel.md` states, no
projectile in flight, pressure at 0, no active machinery, the chain step at 1,
and the quota at the level's full value less the cores the channel opens with.
The injector draws a fresh loaded and queued charge. The score persists across
levels and cell spends for the whole run.

## Clearing a level

A level is cleared the moment its quota is exhausted and no cores remain on the
channel. Every clear adds 500 to the score. Clearing levels 1 through 4 opens a
2 s interlude, after which the next level begins. Clearing level 5 moves the
game to `victory` on the clearing tick, with no interlude.

## Cells

A run starts with 3 cells. A core whose arc position `s` reaches 5000 arrives at
the intake and spends a cell, which sets the run back as follows. A tick spends
one cell at most.

| Figure           | Value after the spend                            |
| ---------------- | ------------------------------------------------ |
| Cells            | one fewer                                        |
| The channel      | every core removed                               |
| Projectiles      | every one discarded                              |
| Pressure         | 0                                                |
| Active machinery | cleared                                          |
| Chain step       | 1                                                |
| Quota            | what a level start leaves it                     |
| Level            | unchanged, and it restarts after a 2 s interlude |

A spend that takes the count to 0 ends the run in place of restarting the
level, so the third arrival is a run's last.

## Interludes and endings

An interlude lasts 2 s. It ends on its own, and the level that follows it begins
at once. An ending holds until it is dismissed, and dismissing it returns the
game to the title screen with every value of a fresh run restored.

| Event                              | Screen     | What follows                        |
| ---------------------------------- | ---------- | ----------------------------------- |
| Levels 1 through 4 cleared         | `cleared`  | the next level, after the interlude |
| Level 5 cleared                    | `victory`  | the run is over                     |
| A cell spent with cells remaining  | `setback`  | the same level, after the interlude |
| A cell spent taking the count to 0 | `gameover` | the run is over                     |

## Danger

The run is in danger while the head's `s` is at least 4000. The condition is
evaluated every tick and holds only while a head exists, so an empty channel and
an interlude are never in danger. While it holds, the field carries a visible
warning, which clears on the tick the head's `s` falls below 4000 or the channel
empties.
