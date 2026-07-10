# Coil — Classic mode

This file defines the standard game mode. It builds on the board in
`specs/playfield.md`, the simulation in `specs/mechanics.md`, and the scoring and
flow in `specs/flow.md`.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), as the **first** menu item:

- `CLASSIC`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Mode

- **Classic** — the game on the fully enclosed `30 x 18` board from
  `specs/playfield.md`. The four walls are solid and fatal, and exactly one pellet
  is on the board at a time.

Classic uses the tick interval (**125 ms**, see `specs/mechanics.md`), the
single-pellet placement (`specs/playfield.md`), the combo scoring
(`specs/mechanics.md` and `specs/flow.md`), and the collision and growth rules
exactly as those specs define them.
