# Meltdown — The surge

The surge is what crosses the floor. This file defines the six types and what
each one carries. How they cross is in `specs/mazing.md`, what a wave is made of
is in `specs/waves.md`, and what a kill pays is in `specs/economy.md`.

## The types

| Type | HP | Speed | Slowable | Flies | Bounty | Leak |
| --- | --- | --- | --- | --- | --- | --- |
| Mote | 40 | 60 | yes | no | 3 | 1 |
| Sprint | 24 | 120 | yes | no | 3 | 1 |
| Hulk | 220 | 38 | yes | no | 7 | 2 |
| Swarm | 12 | 70 | yes | no | 2 | 1 |
| Drift | 60 | 80 | yes | yes | 6 | 1 |
| Core | 1600 | 30 | no | no | 90 | 5 |

HP is the type's base hp before the per-wave scaling of `specs/waves.md`. Speed
is the unit's base speed, in logical units per second; its current speed is that
base reduced by any live slow, as `specs/combat.md` states. Bounty is the money a
kill pays and leak is the lives a leak costs.

## Entering the floor

A unit enters at one of the two vents. Its centre appears on the centre of an
open opening tile of that vent, and it is assigned that vent's fixed opposite
exhaust for its whole life, as `specs/floor.md` states. A unit never appears on
an opening tile a tower's footprint has covered. Which of the open tiles it
appears on is the build's own choice, and it carries no randomness: the vent draw
of `specs/waves.md` is the only randomness in the game.

A unit's maximum hp is its base hp scaled for the wave it belongs to, and its hp
starts full.

## Leaving the floor

A unit is removed from the floor on the frame either of these happens:

| What happened | What it costs |
| --- | --- |
| Its hp reached `0` | Nothing. The emitter that landed the blow takes the kill and the player takes the bounty. |
| It reached its assigned exhaust | Its leak value in lives. |

`specs/mazing.md` states when a unit counts as having reached its exhaust. Lives
lost to a leak never come back.
