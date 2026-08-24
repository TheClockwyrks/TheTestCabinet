# Gantry — The six sites

This file is authoritative for every site: the build envelope, the anchors,
the budget, the loads, the obstacles, and the par figures the results screen
shows. Build the sites exactly as written, in this order, with nothing
substituted, moved, or resized. The terms are the ones `specs/world.md`
defines; every load pose is its lift point, `(x, y, z)` and a yaw in degrees,
and every load starts at rest on the ground or on the obstacle top its pose
puts it on.

An envelope is written as its inclusive ranges. An obstacle is written as its
minimum corner and its size per axis. Par figures are a target to beat, shown
beside a clear's score; they gate nothing.

## Site 1 — First Lift

| | |
| --- | --- |
| Envelope | `x -8..12`, `y 0..16`, `z -8..12` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `3000` |
| Par | cost `2200`, time `60` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `crate` | `40` | `(10, 2, 0)` yaw `0` | `(0, 2, 10)` yaw `0` |

No obstacles. One crate, a quarter turn around the yard: a tower, an arm, a
track, and a first tape.

## Site 2 — Turnabout

| | |
| --- | --- |
| Envelope | `x -10..12`, `y 0..16`, `z -10..12` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `3600` |
| Par | cost `2600`, time `150` |

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
| Budget | `3600` |
| Par | cost `2600`, time `120` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `crate` | `50` | `(9, 2, 0)` yaw `0` | `(-5, 2, 0)` yaw `0` |

| Obstacle | Min corner | Size |
| --- | --- | --- |
| Wall | `(5, 0, -6)` | `(1, 8, 12)` |

One crate whose path crosses a wall eight units high: the lift goes up, over,
and down, and the crane is built tall enough to do it.

## Site 4 — Long Reach

| | |
| --- | --- |
| Envelope | `x -10..20`, `y 0..20`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `5200` |
| Par | cost `4000`, time `180` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `container` | `90` | `(6, 2, -6)` yaw `0` | `(16, 2, 6)` yaw `90` |

No obstacles. A heavy container delivered far from the tower, turned a quarter
on the way: a long arm, the trolley doing real work, and the reach paid for in
stays and counterweight.

## Site 5 — High Shelf

| | |
| --- | --- |
| Envelope | `x -12..12`, `y 0..18`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)` |
| Budget | `4800` |
| Par | cost `3600`, time `210` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `container` | `80` | `(8, 2, 0)` yaw `0` | `(-7, 8, 0)` yaw `90` |
| 2 | `crate` | `40` | `(8, 2, -5)` yaw `0` | `(-7, 2, 4)` yaw `0` |

| Obstacle | Min corner | Size |
| --- | --- | --- |
| Platform | `(-9, 0, -2)` | `(4, 6, 4)` |

A container set down on top of a six-unit platform, turned to fit it, and a
crate placed on the ground beside: the platform is solid, so the container is
lowered onto it from above.

## Site 6 — Heavy Haul

| | |
| --- | --- |
| Envelope | `x -10..18`, `y 0..20`, `z -8..8` |
| Anchors | `(0,0,0)`, `(2,0,0)`, `(4,0,0)`, `(0,0,2)`, `(2,0,2)`, `(4,0,2)`, `(0,0,4)`, `(2,0,4)`, `(4,0,4)` |
| Budget | `6000` |
| Par | cost `4400`, time `240` |

| Load | Class | Mass | From | To |
| --- | --- | --- | --- | --- |
| 1 | `drum` | `120` | `(7, 3, 0)` yaw `0` | `(-7, 3, 0)` yaw `0` |
| 2 | `crate` | `30` | `(14, 2, 4)` yaw `0` | `(-4, 2, -6)` yaw `0` |

No obstacles. The heaviest load in the game and a light crate far down the
yard, from one crane: strength close in, reach far out, and a wider anchor
field to build both on.

## Names

`SITE_NAMES` carries the six names in order: `First Lift`, `Turnabout`,
`Over the Wall`, `Long Reach`, `High Shelf`, `Heavy Haul`.
