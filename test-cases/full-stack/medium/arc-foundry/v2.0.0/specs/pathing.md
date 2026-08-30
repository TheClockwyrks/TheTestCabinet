# Arc Foundry — Pathing and the maze

The yard has no fixed track. The Load crosses it by pathfinding, and every structure the
player builds is a wall, so building is what lengthens the route. This file fixes how a
unit crosses the yard, how a route's length is measured, which placements are refused,
and when the route is recomputed. The grid, the tile states, and each map's coordinates
are in `specs/yard.md`.

## The ordered chain

Each map defines an ordered chain of checkpoints:

```
Entry -> WP1 -> WP2 -> ... -> WP6 -> Collector
```

Every non-flying unit reaches each checkpoint in sequence. It heads for `WP1` first, then
`WP2`, and so on, and finally for the collector, where it grounds out and is removed. A
unit never skips or reorders checkpoints. A unit targets the anchor tile of the waypoint
platform it is heading for.

Each waypoint is drawn with its order number, `1` through `6`, and those numbers are
drawn last, over the structures and the units, so nothing on the yard obscures the chain.

## The route between consecutive checkpoints

Between its current position and the checkpoint it is heading for, a unit takes the open
route of least total length. The route is a sequence of steps between tile centers over
tiles the Load may cross, which are the Open tiles and the Waypoint tiles of
`specs/yard.md`. A unit solves the leg it is on, walks it, and then solves the next; it
never optimizes the whole chain at once.

### Steps

A step goes to an orthogonally or diagonally adjacent crossable tile. A diagonal step is
permitted only when both of the orthogonally adjacent tiles it cuts past are crossable,
so the Load never squeezes through the corner gap between two diagonally touching walls.

### Length

A route's length is the sum of its step lengths, measured in tiles.

| Step | Length |
| --- | --- |
| Orthogonal | `1` |
| Diagonal | `sqrt(2)`, about `1.4142` |

Length, not step count, is what the route minimizes and what every route figure in this
game is reported in.

## Maze length

The maze length is the total length of the ground route the Load walks from the entry
through every waypoint in order to the collector, over the yard as it currently stands,
in tiles. It is the sum of the seven legs' lengths. Flying units ignore the maze, so they
are not part of this figure.

## Progress along the chain

A unit's progress toward the collector orders the Load from furthest along to least far
along. It is compared first by the index of the checkpoint the unit is heading for, and
then, among units heading for the same checkpoint, by the remaining length of that unit's
route to it, shorter first. This ordering is what the `first` and `last` targeting
priorities of `specs/components.md` select on.

## The never-seal rule

A placement is refused when, with its footprint added as a wall, either of the following
would hold:

- Any leg of the chain, `Entry → WP1` through `WP6 → Collector`, would have no open
  route.
- Any unit already on the yard would have no open route to the checkpoint it is heading
  for.

No placement can therefore fully block a leg. Because both legs touching a waypoint
platform must stay open, no placement can encircle a waypoint either. The build interface
shows a refused placement as illegal and does not place it.

Every wall the route must go around lengthens that route, and no wall closes it, so the
maze length can only rise as the player builds.

## Recomputing the route

The route is recomputed the moment the walls change, so the maze length and any drawn
route reflect the yard immediately. The walls change in exactly two ways: a rock is
placed, and a structure is dismantled. Both are build-phase actions, and no unit is on
the yard during a build phase, so the recompute never happens under a walking unit.

Nothing available during a live wave changes a tile's state. A combine leaves every
consumed footprint walled, and refining the press, upgrading a combination tower, and
changing a targeting priority touch no tile. A wave therefore walks the maze it started
with, from its first spawn to its last.

## Flying units

A flying unit ignores the maze. It flies in straight lines from the entry through each
waypoint anchor in order to the collector, passing over every structure and every wall,
and no wall slows or redirects it. Any component whose range covers it can fire at it
while it is over the yard. `specs/enemies.md` states which unit flies.
