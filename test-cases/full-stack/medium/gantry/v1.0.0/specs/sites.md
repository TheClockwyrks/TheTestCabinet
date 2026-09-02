# Gantry — The six sites

This file is authoritative for every site: the build envelope, the anchors,
the budget, the loads, the obstacles, and the par figures the results screen
shows. Build the sites exactly as written, in this order, with nothing
substituted, moved, or resized. The terms are the ones `specs/world.md`
defines, and each `From` and `To` below is a load's lift point, `(x, y, z)`,
followed by its yaw in degrees.

Par figures are targets to beat, shown beside a clear's score; they gate
nothing. Each site sets two, a par cost and a par time, and a score meets them
one at a time: the par cost is beaten by a crane that costs less, the par time
by a run that finishes sooner.

## Site 1 — First Lift

| | |
| --- | --- |
| Envelope | `x -8..12`, `y 0..16`, `z -8..12` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `3000` |
| Par | cost `2400`, time `18` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `crate` | `40` | `(10, 2, 0)` yaw `0` | `(0, 2, 10)` yaw `0` |

No obstacles. One crate, a quarter turn around the yard.

## Site 2 — Turnabout

| | |
| --- | --- |
| Envelope | `x -10..12`, `y 0..16`, `z -10..12` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `3600` |
| Par | cost `2400`, time `55` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `crate` | `40` | `(9, 2, 0)` yaw `0` | `(-7, 2, 0)` yaw `0` |
| 2 | `crate` | `60` | `(0, 2, 9)` yaw `0` | `(0, 2, -7)` yaw `0` |

No obstacles. Two crates, each straight across the yard.

## Site 3 — Over the Wall

| | |
| --- | --- |
| Envelope | `x -10..12`, `y 0..18`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `4000` |
| Par | cost `3550`, time `40` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `crate` | `50` | `(9, 2, 0)` yaw `0` | `(-5, 2, 0)` yaw `0` |

| Obstacle | Min corner | Size |
| --- | --- | --- |
| Wall | `(5, 0, -6)` | `(1, 8, 12)` |

One crate whose path crosses the wall: the lift goes up, over, and down.

## Site 4 — Long Reach

| | |
| --- | --- |
| Envelope | `x -10..20`, `y 0..20`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `5600` |
| Par | cost `5250`, time `47` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `container` | `90` | `(6, 2, -6)` yaw `0` | `(14, 2, 6)` yaw `90` |

No obstacles. A heavy container delivered far from the anchors, turned a
quarter on the way.

## Site 5 — High Shelf

| | |
| --- | --- |
| Envelope | `x -12..12`, `y 0..18`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `4800` |
| Par | cost `4200`, time `101` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `container` | `80` | `(8, 2, 0)` yaw `0` | `(-7, 8, 0)` yaw `90` |
| 2 | `crate` | `40` | `(8, 2, -5)` yaw `0` | `(-7, 2, 4)` yaw `0` |

| Obstacle | Min corner | Size |
| --- | --- | --- |
| Platform | `(-9, 0, -2)` | `(4, 6, 4)` |

A container set down on top of the platform, turned a quarter as its target
pose asks, and a crate placed on the ground beside it.

## Site 6 — Heavy Haul

| | |
| --- | --- |
| Envelope | `x -10..18`, `y 0..20`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(4,0,0)`, `(0,0,2)`, `(2,0,2)`, `(4,0,2)`, `(0,0,4)`, `(2,0,4)`, `(4,0,4)` |
| Budget | `6000` |
| Par | cost `4750`, time `107` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `drum` | `120` | `(7, 3, 0)` yaw `0` | `(-7, 3, 0)` yaw `0` |
| 2 | `crate` | `30` | `(14, 2, 4)` yaw `0` | `(-4, 2, -6)` yaw `0` |

No obstacles. The heaviest load in the game and a light crate far down the
yard, from one crane.

## The site table

`SITES` carries the six sites in the order above, each with its envelope, its
anchors, its budget, its par cost and par time, its loads, and its obstacles,
exactly as this file states them. `SITE_NAMES` carries the six names in order:
`First Lift`, `Turnabout`, `Over the Wall`, `Long Reach`, `High Shelf`,
`Heavy Haul`.
