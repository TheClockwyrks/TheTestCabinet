# Coil — Classic mode

This file defines this build's one playable mode, **Classic**, and its main-menu
entry. It builds on the board in `specs/playfield.md`, the simulation in
`specs/mechanics.md`, and the scoring and flow in `specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `CLASSIC`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Classic

- **Classic** — the standard game on the fully enclosed `30 x 18` board from
  `specs/playfield.md`. The four perimeter walls are **solid and fatal** and the
  board does **not** wrap, so the interior playable area is `28 x 16` (`col` in
  `[1, 28]`, `row` in `[1, 16]`). Exactly one pellet is on the board at a time,
  there are no interior obstacles, and there is no bonus orb.

Classic uses the 125 ms tick interval (`specs/mechanics.md`), the standard
single-pellet placement (`specs/playfield.md`), the combo scoring
(`specs/mechanics.md` and `specs/flow.md`), and the standard collision and growth
rules.
