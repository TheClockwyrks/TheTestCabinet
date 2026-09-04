# Fathom — Plankton, drifters, and getting caught

This file defines what lives in the corridors of a maze and what the forager
gets from it: the plankton it grazes, the bonus drifters that wander in, and
what contact with a predator costs. Every figure below carries the name this
specification gives it.

The forager's tile is the tile its center lies on, and the tile is what these
rules are decided on.

## Plankton

A maze is laid out with one plankton on each of its corridor tiles. The den
chamber and its gate hold none. `planktonRemaining` is how many are still on the
board.

A plankton is drawn as a small glowing mote about `PLANKTON_DOT` (`6`) logical
units across, centered on its tile.

The forager eats the plankton on its own tile, the moment its center enters that
tile. Eating takes the plankton off the board, lowers `planktonRemaining` by
one, and adds to the score. Eating the plankton that leaves none behind clears
the maze.

## The bonus drifters

A bonus drifter is a harmless amber creature that wanders the corridors and pays
a bonus when the forager eats it.

While plankton remain in the maze, drifters are admitted at the den gate on a
cadence of `DRIFTER_INTERVAL` (`25 s`). The cadence tops the maze up to
`DRIFTER_MAX` (`2`) drifters at once and stops there, so a maze already holding
`DRIFTER_MAX` of them admits none until one is eaten.

A drifter travels the corridor center lines at `DRIFTER_SPEED` (`64` logical
units per second), half the forager's speed, and changes direction at tile
centers. At each tile center it takes a direction drawn at random from the open
directions there, preferring one other than the one it came from, and it turns
back the way it came where the tile offers no other open direction. It passes
through the wrap tunnel like the forager.

A drifter stays in the maze until it is eaten, holding its glow and its pace for
as long as that takes. The forager eats a drifter whose center lies on the
forager's own tile, which takes it off the board and scores the bonus.

## The amber lights

A drifter shows in the dark as a single glowing amber mote. A wandering
Lanternjaw's bulb-light is drawn as the same mote, and a wandering Lanternjaw
drifts at `DRIFTER_SPEED` on the same wander, so the two are alike in look and
in motion and one glimmer cannot be told from the other at a glance.

## Getting caught

Contact costs a life. The forager is in contact with a predator whose center
lies on the forager's own tile, whatever that predator's kind and whatever it is
doing. On contact `lives` drops by one and the board resets for another attempt,
unless `lives` is already `0`, in which case the run ends instead and `screen`
becomes `"gameover"`. `specs/progression.md` fixes the arrangement that reset
leaves the maze in.
