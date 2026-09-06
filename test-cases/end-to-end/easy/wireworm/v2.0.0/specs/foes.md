# Wireworm — The support foes

Three foes work the board alongside the worm, each reshaping the node field in
its own way. This file defines each one's motion, its effect on the field, how
many bolts it takes, and the level it starts appearing at. What a foe reaching
the cursor costs is in `specs/cursor.md`, and what killing one pays is in
`specs/scoring.md`.

## How a foe acts on the field

A foe acts on the tile its center occupies, and only on that tile. A foe standing
still therefore acts on the one tile it stands on, and a travelling foe acts on
each tile its center crosses in turn. `specs/board.md` gives the tile a center
falls in.

Every foe carries a velocity in logical units per second, integrated against the
delta time of each update.

## The glitch

The glitch skitters through the lower board and eats the field.

| Figure              | Constant               | Value                  |
| ------------------- | ---------------------- | ---------------------- |
| Horizontal speed    | `GLITCH_H_SPEED`       | `210` units per second |
| Downward speed      | `GLITCH_V_SPEED`       | `62` units per second  |
| Dart interval       | `GLITCH_DART_INTERVAL` | `0.32` s               |
| Bolts to destroy it |                        | `1`                    |

### Motion

A glitch travels horizontally at `GLITCH_H_SPEED` in its current horizontal
direction and downward at `GLITCH_V_SPEED`, both at once.

Its horizontal direction reverses at each `GLITCH_DART_INTERVAL`, so it darts
back and forth as it descends. The dart clock starts when the glitch comes into
existence and runs on the same accumulate-and-carry rule the worm's step clock
uses, so a frame covering several intervals makes several reversals. The
horizontal direction also reverses when the glitch's center reaches a side edge
of the board, at `x` of `0` or `1280`.

A glitch whose center passes below the board, at `y` past `720`, leaves the board
and is gone.

### What it does

A glitch removes the node on the tile its center occupies, whatever that node's
charge. A critical node eaten this way is removed without detonating, so no
discharge fires and no arc is reported.

### When one appears

Glitches begin at `GLITCH_FROM_LEVEL` (`2`), and none appears at level `1`. From
that level on, a glitch enters after an interval drawn from the run's seeded
generator between `GLITCH_MIN_INTERVAL` (`7.0` s) and `GLITCH_MAX_INTERVAL`
(`12.0` s), timed from the moment the level's play becomes active, and each
further glitch after another such interval.

At most `GLITCH_MAX_ON_BOARD` (`2`) glitches are on the board at once. While two
are on it, no further glitch enters.

A glitch enters with its center on the center of the edge column of the edge it
entered at, at `x` of `16` entering from the left and `1264` entering from the
right, and on the center of a row drawn from the run's seeded generator between
`8` and `15` inclusive. Its horizontal direction points inward from that edge.

## The dropper

The dropper falls down a column and reseeds the field beneath it.

| Figure                          | Constant            | Value                  |
| ------------------------------- | ------------------- | ---------------------- |
| Fall speed                      | `DROPPER_SPEED`     | `150` units per second |
| Fall speed after its first bolt | `DROPPER_SPEED_HIT` | `320` units per second |
| Bolts to destroy it             |                     | `2`                    |

### Motion

A dropper falls straight down at `DROPPER_SPEED`. Its center `x` never changes
for the whole of its fall, and it never moves upward. A dropper whose center
passes below the board, at `y` past `720`, leaves the board and is gone.

### What it does

A dropper lays a fresh node at charge `0` on the tile its center occupies
whenever that tile is empty and lies in rows `1` to `17`. A tile that already
holds a node is left exactly as it is, at the charge it had, and no node is laid
in row `0` or in the player band.

### What a bolt does to it

The first bolt into a dropper does not destroy it. It sets the dropper's hit
flag, and from that moment the dropper falls at `DROPPER_SPEED_HIT` for the rest
of its fall. A bolt into a dropper whose hit flag is already set destroys it.

### When one appears

Droppers begin at `DROPPER_FROM_LEVEL` (`3`), and none appears at levels `1` and
`2`. From that level on, the nodes standing in rows `10` to `19` are counted
every `DROPPER_CHECK_INTERVAL` (`2.5` s) of active play. When that count is below
`DROPPER_SPARSE_THRESHOLD` (`8`), one dropper enters; when it is `8` or above,
none does.

A dropper enters with its center on the center of row `0`, at `y` of `96`, and on
the center of a column drawn from the run's seeded generator, falling.

## The corruptor

The corruptor crawls across the upper board and slams the field to critical.

| Figure              | Constant          | Value                  |
| ------------------- | ----------------- | ---------------------- |
| Crawl speed         | `CORRUPTOR_SPEED` | `130` units per second |
| Bolts to destroy it |                   | `1`                    |

### Motion

A corruptor crawls horizontally at `CORRUPTOR_SPEED` in the direction it entered
from. Its center `y` never changes: it holds the row it entered on for the whole
crossing and never descends. A corruptor whose center passes a side edge of the
board, at `x` past `0` or `1280`, leaves the board and is gone.

### What it does

A corruptor sets the node on the tile its center occupies to `CHARGE_MAX` (`3`),
whatever charge that node held, so a node it crosses goes straight to critical
rather than up one level. It lays no node on an empty tile.

### When one appears

Corruptors begin at `CORRUPTOR_FROM_LEVEL` (`5`), and none appears at levels `1`
through `4`. From that level on, a corruptor enters after an interval drawn from
the run's seeded generator between `CORRUPTOR_MIN_INTERVAL` (`14.0` s) and
`CORRUPTOR_MAX_INTERVAL` (`22.0` s), timed from the moment the level's play
becomes active, and each further corruptor after another such interval.

A corruptor enters with its center on the center of the edge column of the edge
it entered at, at `x` of `16` entering from the left and `1264` entering from the
right, and on the center of a row drawn from the run's seeded generator between
`1` and `6` inclusive. Its direction points inward from that edge.
