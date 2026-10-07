# Meltdown — Towers are walls

There is no fixed path across the reactor floor. Every tower is also a wall, so
the player builds the maze the surge walks. This file defines what a tower blocks,
how the surge crosses the floor, how the routes are measured and kept live, and
the one placement a build refuses.

## Every tower is a wall

A tower blocks every tile of its footprint from the frame it lands until the
frame it leaves, whatever its size and whatever kind of tower it is. The Forge
and the Sink block their tiles exactly as an emitter does. A blocked tile is not
open floor: no surge route passes through one.

## How the surge crosses the floor

A ground unit walks between tile centres. From the tile its centre occupies it
may step to an orthogonally adjacent open tile, or to a diagonally adjacent open
tile when both of the orthogonal tiles that step cuts past are also open. A
diagonal between two diagonally-touching towers is therefore not a step, and the
unit goes around.

A unit travels toward the centre of the next tile of its route at its current
speed, in logical units per second. An orthogonal step covers `TILE` logical
units and a diagonal step covers `TILE * sqrt(2)`.

A unit leaves the floor when the tile its centre occupies is one of the opening
tiles of its assigned exhaust, which is the fixed opposite of the vent it entered
at. `specs/surge.md` states what leaving costs.

## The route and its length

A unit's route is the cheapest sequence of steps, under the rule above, from the
tile its centre occupies to any open opening tile of its assigned exhaust. A
route's length is measured in tiles: an orthogonal step costs `1` and a diagonal
step costs `sqrt(2)`. The route's remaining length is what the unit reports as
`remaining`.

The floor also carries the two vent-to-exhaust routes: the cheapest route, by the
same rule and the same metric, from any open opening tile of a vent to any open
opening tile of that vent's opposite exhaust. Their lengths are what the game
reports as `paths.left.length` and `paths.top.length`.

Nothing fixes which of several equal-cost routes a unit takes, and a route is
free to lead back over ground the unit has already covered when that is the
cheapest way to the exhaust.

## Live re-pathing

Every route is recomputed on the frame the set of blocked tiles changes: a tower
placed, a tower sold, or a tower otherwise added to or removed from the floor.
Each unit's route is recomputed from the tile its centre occupies at that moment,
and a recomputation moves nothing: every unit's centre on the frame the floor
changed is exactly where the frame's own movement left it.

## The floor can never be sealed

A placement is refused when, with the candidate footprint's tiles blocked as well:

- either vent's opening would have no route to the opening of its opposite
  exhaust, or
- any ground unit already on the floor would have no route from the tile its
  centre occupies to the opening of its assigned exhaust.

A refused placement reads invalid and builds nothing, exactly as any other
invalid footprint does. `specs/building.md` states the rest of the placement
check.

An opening's tiles are ordinary floor, so a footprint may cover part of an
opening. A footprint covering three of the left vent's four opening tiles is
allowed, because the route through the fourth remains.

## Flyers ignore the maze

A flying surge unit takes no route and no step. It travels in a straight line,
at its own speed, from the point it entered at to the centre of its assigned
exhaust's opening, which is the midpoint of that opening's run of tile centres.
It passes over every tower and every wall, and neither its line nor the time it
takes to cross changes when the floor does.

A flyer's `remaining` is the straight-line distance from its centre to that same
point, divided by `TILE`. It leaves the floor under the same rule a walker does,
when the tile its centre occupies is one of its assigned exhaust's opening tiles.
