# Valence — Overload

This file (`specs/mode.md`) defines the campaign start this run plays and its main-menu
entry. It is the standard Valence campaign — the same board, matter, towers, and 20-round
progression — **run scarce and front-loaded**: you start with less energy and integrity,
interest is disabled, and the forms that demand a specific tool arrive several rounds earlier,
so the board is under pressure from the opening. It builds on the board in `specs/board.md`,
the matter in `specs/matter.md`, the towers in `specs/towers.md`, the controls in
`specs/controls.md`, and the flow in `specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in `specs/flow.md`),
before `HOW TO PLAY`:

- `OVERLOAD`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown last
in the menu.)

## The start

- **Overload** — the campaign opened scarce. Three things are harder than the standard start,
  and everything else is exactly as the common specs define it:
  - **Less to start.** A **starting energy of `350`** and a **starting integrity of `60`**
    (against the standard `500` / `100`, `specs/flow.md`), so the opening board is
    thinner and every leak hurts more.
  - **No interest.** The between-round **interest is disabled** (`specs/flow.md`), so energy
    comes only from breaking matter down and the round-clear and early-send bonuses,
    so banking to spike an upgrade later is not on the table, and every unit that leaks
    un-neutralized is
    energy as well as integrity lost.
  - **Front-loaded forms.** The forms that each demand a specific tool arrive **earlier**:
    **Dimers** and **Polymers**, **Nobles**, and **Heavies** (`specs/matter.md`) each begin
    several rounds sooner than a comfortable ramp would introduce them, so the player must
    field a Shear, a Catalyst, and Fission early rather than leaning on ionizers through the
    opening. The milestone boss rounds (`specs/flow.md`) are unchanged in position.

This start uses every other system exactly as the common specs define it — the board, the
decomposition model, the towers, the controls, and the 20-round progression, scoring, states,
and HUD — with no overrides beyond the scarcer opening, the disabled interest, and the earlier
introduction of the tool-specific forms above.

The scarce, front-loaded opening must be **real and felt**: a campaign that opens with the
standard energy and integrity, pays interest, or holds the molecule/noble/heavy forms
back to their standard rounds has not implemented this start.
