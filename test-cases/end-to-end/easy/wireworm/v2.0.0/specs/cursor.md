# Wireworm — The cursor and its bolts

The cursor is the player: a defrag cutter confined to the band along the floor,
firing bolts straight up the board. This file defines how it moves, how it
fires, how a bolt travels and what it resolves against, and what a worm segment
or a foe reaching the cursor costs. The band's bounds are in `specs/board.md`,
and the keys are in `specs/controls.md`.

## Moving in the band

The cursor moves freely in logical units inside the player band, never snapping
to tiles. Its center is clamped to the band's four bounds, `CURSOR_X_MIN` (`16`),
`CURSOR_X_MAX` (`1264`), `CURSOR_Y_MIN` (`672`), and `CURSOR_Y_MAX` (`704`), so
it never leaves the band. A movement held against a bound leaves the cursor
resting exactly on that bound.

While a movement is held the cursor travels at `CURSOR_SPEED` (`430`) units per
second, integrated against the delta time of each update. The rate is the same in
every direction. Two perpendicular movements held together move the cursor along
the diagonal at that same `CURSOR_SPEED`, so each axis contributes
`CURSOR_SPEED / sqrt(2)` (about `304`) units per second rather than the full
`430`. Opposite movements held together cancel on that axis.

## Firing

The cursor fires upward bolts, one at a time.

| Figure                  | Constant        | Value                  |
| ----------------------- | --------------- | ---------------------- |
| Interval between bolts  | `FIRE_INTERVAL` | `0.15` s               |
| Bolts in flight at once | `MAX_BOLTS`     | `3`                    |
| Bolt speed              | `BOLT_SPEED`    | `900` units per second |

The cursor carries a fire cooldown in seconds, which counts down against the
delta time of each update and rests at `0`. While the fire action is held, a bolt
is fired whenever the cooldown is at `0` and fewer than `MAX_BOLTS` bolts are in
flight, and firing sets the cooldown to `FIRE_INTERVAL`. A held fire action
therefore produces a bolt every `FIRE_INTERVAL` until the cap binds.

A bolt is created with its center in the cursor's column, at the cursor's center
`x`, and `CURSOR_HALF` (`12`) units above the cursor's center `y`.

## A bolt in flight

A bolt travels straight up at `BOLT_SPEED`, integrated against the delta time of
each update. Its center `x` never changes.

As it climbs it resolves against the first thing its center reaches, which is the
lowest of the following that lies above it in its column:

| Struck         | Reached when                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| A worm segment | The bolt's center is inside the segment's tile.                                                        |
| A node         | The bolt's center is inside the node's tile.                                                           |
| A foe          | The bolt's center is inside the foe's box, `FOE_HALF` (`12`) units from the foe's center on each axis. |

A bolt resolves against exactly one thing and is removed from flight in the same
update. Where a worm segment and a node share a tile, the bolt resolves against
the segment. `specs/nodes.md`, `specs/worm.md`, and `specs/foes.md` state what
each outcome does.

A bolt that reaches the top of the board without resolving against anything is
gone: once its center passes `BOARD_Y` (`80`), it leaves the board and is removed
from flight.

## Contact costs a life

A worm segment or a foe reaching the cursor costs one life. The cursor's box is
`CURSOR_HALF` (`12`) units from its center on each axis, and contact is an
overlap of boxes:

- A foe reaches the cursor when the foe's box, `FOE_HALF` (`12`) units from its
  center on each axis, overlaps the cursor's box.
- A worm segment reaches the cursor when the segment's tile overlaps the cursor's
  box.

`specs/progression.md` states what losing a life does. While the cursor's
spawn-in invulnerability is still running, a contact costs no life and nothing is
removed by it, so the cursor plays on through whatever it is standing in.
