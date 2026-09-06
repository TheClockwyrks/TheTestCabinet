# Wireworm — The data-worm

The data-worm is what a level is fought against. This file defines how a worm is
built, the clock it steps on, how it winds down the board, when it dives, and
what happens when its segments are removed. The tile grid it steps over is in
`specs/board.md`, and what a block does to the node that caused it is in
`specs/nodes.md`.

## Structure

A worm is a chain of segments, each occupying one tile. The segments are ordered
from the head:

| Segment | Position in the chain |
| --- | --- |
| Head | The first segment, which leads. |
| Body | Every segment between the head and the tail. |
| Tail | The last segment. |

A worm of one segment is a head alone. Consecutive segments always occupy
orthogonally adjacent tiles, because the chain follows the head's own path.

A worm carries two headings and a diving flag:

| Field | Values |
| --- | --- |
| `dh`, the horizontal heading | `+1` for right, `-1` for left |
| `dv`, the vertical heading | `+1` for down, `-1` for up |
| `diving` | Whether the worm is driving straight down its column |

## The step clock

A worm moves in whole tile steps rather than continuously. Each worm carries its
own step clock, which accumulates the simulated time that passes. Each time the
accumulated time reaches the level's step interval, the worm takes one step and
the interval is taken off the accumulator, so a frame covering several intervals
runs several steps in order and the remainder carries into the next frame.

A worm's step clock starts at zero when the worm comes into existence: entering
at the start of a level, entering after a respawn, or being created as a
surviving run of a worm whose segments were removed.

The interval is the level's, and it shortens as the run climbs:

```
wormStepInterval(level) =
  max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
```

with `WORM_STEP_L1` (`0.14`), `WORM_STEP_DECAY` (`0.95`), and `WORM_STEP_FLOOR`
(`0.07`), all in seconds. Level 1 steps every `0.14` s and level 12 every
`0.0796` s. The floor is a bound the twelve levels of a run never reach, so the
interval within a run is always the decayed figure. Every worm on the board at a
level steps on that level's interval.

## Length and entry

A level brings in one worm, carrying

```
wormLength(level) = WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)
```

segments, with `WORM_BASE_LENGTH` (`10`) and `WORM_LENGTH_PER_LEVEL` (`2`). That
is `10` segments at level 1 and `32` at level 12.

The worm enters along row `0`, the entry row, from the left edge or the right
edge, each with probability `1/2`.

Every one of its segments is laid on row `0`, in a run of consecutive columns
that stands against the edge it entered at. Entering from the left, the tail
occupies column `0` and the head column `wormLength(level) - 1`; entering from
the right, the tail occupies column `39` and the head column
`40 - wormLength(level)`. The head is the end furthest from that edge and the
tail the end nearest it.

Its horizontal heading points inward from the edge it entered at: `dh` is `+1`
entering from the left and `-1` entering from the right. Its vertical heading
`dv` is `+1`, down. `specs/progression.md` states when the worm enters.

## Winding down the board

Each step the head either winds or dives.

### Winding

The head attempts to move one tile horizontally, to the tile at `(c + dh, r)`.
That step is blocked when the target tile is any of:

- off the board, which is a column outside `0` to `39`;
- a tile holding a node;
- a tile holding a worm segment, of this worm or of any other.

When the step is not blocked, the head moves to that tile and the worm holds its
row and both headings.

When the step is blocked, the worm turns instead, all within the same step:

1. Its horizontal heading reverses, so `dh` becomes `-dh`.
2. Its vertical heading is checked. If the row at `r + dv` is off the board, which
   is a row outside `0` to `19`, the vertical heading flips first, so `dv` becomes
   `-dv`.
3. The head moves one row in its vertical heading, to `(c, r + dv)`, staying in
   its own column.

A worm on the floor row (`19`) heading down therefore flips to heading up and
rises a row, and a worm on the entry row (`0`) heading up flips to heading down
and drops a row, so a worm oscillates across the lower board rather than leaving
it. A worm never leaves the board through an edge.

Only a horizontal step can be blocked. The vertical move a block produces always
takes the head into the tile at `(c, r + dv)`, whatever stands there. A node or a
worm segment on that tile neither turns the worm nor is destroyed by it, and a
node keeps the charge it had.

### Diving

A block by a node at charge `3`, the critical charge, starts a dive when the head
is above the player band, which is any row above row `BAND_TOP_ROW` (`18`). The
step that starts the dive sets `diving` and moves the head one row down, to
`(c, r + 1)`, staying in its column. A block by a critical node when the head is
already on row `18` or `19` turns the worm the ordinary way instead.

While a worm is diving, each step advances the head one tile down its own column,
to `(c, r + 1)`, whatever stands on the tile it enters. The tile's node or
segment is left exactly as it was, and neither turns the worm nor is destroyed.
The horizontal heading is unchanged throughout.

The dive ends at the end of the step in which the head reaches row
`BAND_TOP_ROW` (`18`) or row `19`. `diving` clears, and the worm winds normally
from the next step.

## The body follows

Every step, once the head has moved, each remaining segment moves into the tile
the segment ahead of it occupied before that step. The chain therefore travels
the head's exact path, one tile behind the segment ahead of it.

## Cutting the worm

A bolt travelling up a column destroys the first worm segment in its path, as
`specs/cursor.md` states. A discharge destroys every segment within its reach, as
`specs/discharge.md` states.

Whenever segments are removed from a worm, whatever removed them, the segments
that survive fall into runs of consecutive segments, counted from the head end.
Each run becomes a worm of its own:

- The first surviving run, counted from the head end, keeps the worm's id, its
  two headings, and its diving flag. Its leading segment is its head.
- Each further run becomes a new worm, taking a fresh id and the same two
  headings and diving flag as the worm it came from. Its leading segment is the
  one that was nearest the break, and that segment is its head and leads it from
  then on.
- New worms are appended to the roster in order from the head end, and each one's
  step clock starts at the moment it is created.
- A worm all of whose segments are removed is gone from the roster.

A bolt into the head therefore leaves one worm, one segment shorter, led by what
was the second segment. A bolt into the tail leaves one worm, one segment
shorter, with the same head. A bolt into a middle segment leaves two worms, the
head-side run and the tail-side run.

Every segment destroyed by a bolt leaves a node behind, and every segment
destroyed by a discharge leaves nothing; `specs/nodes.md` and
`specs/discharge.md` state both. Every segment dies to one hit, whatever its
place in the chain.
