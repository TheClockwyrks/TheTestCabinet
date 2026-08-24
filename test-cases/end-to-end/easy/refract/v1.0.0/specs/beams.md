# Refract — The ruleset

A beam is the chain of segments drawn for one channel, and a segment is the
link between two 8-adjacent nodes. A board declares 1 to 3 channels. Every
channel present has exactly two emitters and any number of lenses, including
none. The player draws one beam per channel. The rules below fall into two
groups: the limits, which decide which segments a beam may carry, and the
completion conditions, which decide when a beam is finished and when the board
is solved. The node kinds these rules refer to are defined in `specs/board.md`;
how a player draws, extends, retracts, and clears a beam is in
`specs/controls.md`.

## Limits

A limit holds of every beam at every moment, from the first segment to the
last.

### R1 Adjacency

A segment joins two nodes whose cells differ by at most 1 in column and at most
1 in row and are not the same cell. Empty cells hold no node and are never part
of a beam. A segment never spans an empty cell.

### R2 Exclusion

A beam never meets an emitter or a lens of another channel.

### R3 Segment exclusivity

Each segment carries at most one beam and is used at most once.

### R4 Diagonal exclusivity

The two diagonals of any 2x2 block of cells are mutually exclusive: at most one
of the two is ever part of a beam.

### R5 Capacity

An emitter carries at most one segment. A lens carries at most two segments of
its own channel. A crystal carrying `n` charges is crossed at most `n` times.

A crossing enters a crystal by one segment and leaves it by another. The charge
is spent on entry and the crossing is completed by leaving, so a beam enters a
crystal only while that crystal has an unspent charge, and a move into a
crystal whose charges are all spent is refused.

## Completion conditions

These describe finished work, not legal moves. A channel's beam is **complete**
when R6 and R7 both hold of it, and the board is solved when R9 holds.

### R6 Endpoints

A channel's beam is complete only when it runs between that channel's two
emitters, with exactly one segment meeting each. An emitter is an end of the
beam and never a pass-through.

### R7 Coverage

A channel's beam is complete only when every lens of that channel carries
exactly two of its segments: the beam enters the lens once and leaves it once.
No lens of a channel present is left unvisited.

### R8 Crystals

A crystal is channel-neutral and any beam may cross it, by any mix of channels,
the same channel more than once included. A crystal is satisfied when all of
its charges are spent and every crossing begun across it has been completed. A
beam that ends on a crystal has begun a crossing it has not completed, and
leaves that crystal unsatisfied.

### R9 Solved

A board is solved when R6 and R7 hold for every channel present and R8 holds
for every crystal on the board.

## Enforcement

The two groups do different jobs, and neither does the other's.

| Rules | How they are used |
| --- | --- |
| R1, R2, R3, R4, R5 | Checked on every move. A move that would break one is refused: the beam is unchanged and the trace stays live. |
| R6, R7, R8 | Never used to refuse a move. They are the conditions R9 reads. |
| R9 | Evaluated after every change. |

A partial beam therefore breaks no rule. It has simply not met the completion
conditions yet.
