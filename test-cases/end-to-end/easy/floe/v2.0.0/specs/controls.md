# Controls

## Overview

This file defines the controls: hopping the critter one tile at a time, and pause.
It refers to the grid and bays in `specs/playfield.md`, the floe drift in
`specs/water.md`, and the vehicles in `specs/hazards.md`.

## Hopping

The critter moves by discrete one-tile hops. This is the only way it moves, and it
never moves more than one tile per hop.

- Keys. The arrow keys and WASD hop the critter exactly one tile in that direction
  (up, down, left, or right) per key press. A brief hop cooldown (about `0.12 s`)
  keeps a held key from firing faster than the critter can hop; there is no charged
  jump, no multi-tile leap, and no diagonal hop.
- Absolute directions. A hop is always one tile in the strait's grid directions,
  regardless of any floe the critter is riding. While on a floe the critter also
  drifts with it between hops (`specs/water.md`), but a hop itself is one absolute
  tile.
- Blocked hops are refused. A hop that would leave the strait (past a side edge,
  below the near shore, or up into the far shore's solid wall or a filled bay,
  `specs/playfield.md`), or onto a tile a vehicle currently occupies
  (`specs/hazards.md`), is refused: the critter does not move, and no life is lost
  for a refused hop. You can never step into a vehicle. Death from a vehicle comes
  only when one slides into the tile the critter is standing on (`specs/hazards.md`);
  death from the water comes from hopping onto open water or drifting off the edge
  (`specs/water.md`); a refused hop never kills.
- Up is progress. Hopping up carries the critter toward the bays; you may hop down
  to retreat, but every moment costs time and lets the bear close (`specs/hunter.md`,
  `specs/flow.md`).

## Pause and menus

- Pause. P or Escape pauses the game from the in-game state, opening the pause menu
  (Resume, Restart, Quit to menu, `specs/flow.md`). Pausing freezes the simulation.
- Menus. In the title and end screens, the menu is navigable by keyboard (arrow keys
  or W/S to move the selection, Enter or Space to confirm). Every menu action is
  reachable by keyboard alone.
- Mute. If you include audio (`specs/flow.md`), provide a mute toggle (for example
  M).

Keyboard only for this version; no touch or gamepad (`specs/flow.md`). A mouse is
not required to play.
