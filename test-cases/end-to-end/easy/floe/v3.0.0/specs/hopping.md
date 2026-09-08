# Floe — Hopping

This file fixes how the critter moves: the one-tile hop, the cadence it may be
repeated at, and every rule that refuses one. A floe drifting under the critter
carries it as well, and `specs/water.md` fixes that carry; the hop is the
critter's own movement and the only one it has.

## The hop

The critter moves in whole tiles, one tile per hop, in one of the four grid
directions. There is no diagonal hop, no multi-tile leap, and no charged jump.

The tile the critter is on is `(colAt(x), rowAt(y))` for its center `(x, y)`, and
a hop's target tile is that tile offset by one in the hopped direction. A hop is
therefore one absolute tile of the strait, whatever the critter is riding and
however far a floe has carried it between tile columns.

An accepted hop:

- sets the critter's center to the target tile's center exactly,
  `(tileCX(col), tileCY(row))`, whatever the center was before the hop;
- sets the critter's facing to the direction hopped;
- sets the hop cooldown to `HOP_COOLDOWN`;
- takes `bestRow` to the target row when that row is above the rows this crossing
  has already reached.

`bestRow` is the topmost row the critter has stood on this crossing. It is
`ROW_NEAR` (`19`) when a crossing begins, and it never moves back down within a
crossing. `specs/scoring.md` and `specs/hunter.md` both read it.

A fresh critter faces `up`.

## The cadence

`HOP_COOLDOWN` is `0.12` s. The cooldown counts down with the simulation, and the
critter hops whenever a direction is being requested and the cooldown has reached
`0`.

- A press while the cooldown is running is ignored, and the critter does not hop.
- A direction held across the cooldown hops again the moment the cooldown reaches
  `0`, so holding a direction auto-repeats at `HOP_COOLDOWN`.
- A press released before the cooldown reaches `0` produces exactly one hop.

## Refused hops

A hop is refused when any of the following holds of its target tile. `specs/ice.md`
fixes when a vehicle covers a tile.

| Refused when the target tile                               |
| ---------------------------------------------------------- |
| Is outside the grid: `inBounds(col, row)` is false.        |
| Is on row `0`, the solid cap of the far shore.             |
| Is on row `1` at a column no bay covers.                   |
| Is on row `1` at a column of a bay that is already filled. |
| Is covered by a vehicle.                                   |

A refused hop leaves everything as it was: the critter stays where it stands with
the same facing, the cooldown is untouched, no life is lost, and nothing is
scored.

Every other target is accepted, including a water tile no floe covers, which
`specs/water.md` fixes the consequence of.
