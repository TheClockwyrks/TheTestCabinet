# Coil — Classic mode

This file defines the game's mode: Classic, the grid-serpent run on the open
board. It builds on the board in `specs/board.md`, the simulation in
`specs/movement.md`, the scoring in `specs/combo.md`, the produced assets in
`specs/assets.md`, and the interface in `specs/interface.md`.

## Menu entry

This mode adds the `CLASSIC` entry to the main menu (see Game states in
`specs/interface.md`), at the top, above `HOW TO PLAY`:

- `CLASSIC`

(`HOW TO PLAY` is a state defined in `specs/interface.md`, not a mode, and is
always shown last in the menu.)

## Mode

Classic is the game on the fully enclosed 30 x 18 board from `specs/board.md`. The
four walls are solid and fatal, and exactly one pellet is on the board at a time.
The interior is open, with no obstacle cells.

Classic uses the tick interval (125 ms, see `specs/movement.md`), the
single-pellet placement (`specs/board.md`), the combo scoring (`specs/combo.md`),
and the collision and growth rules (`specs/movement.md`) exactly as those specs
define them.

The mode's HUD label reads `CLASSIC` (see the HUD in `specs/interface.md`).
