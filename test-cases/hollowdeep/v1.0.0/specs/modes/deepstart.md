# Hollowdeep — Deepstart

This file defines the **Deepstart** start, which sits alongside the standard colony
start. It builds on the standard start in `specs/modes/survival.md` and changes only
the **opening conditions** — how much air and material the colony begins with;
everything else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `DEEPSTART`

Place it after `NEW COLONY` and before `HOW TO PLAY`.

## The start

- **Deepstart** — the same colony and the same systems as the standard start, but
  opened **scarce**. Two things change at the start:
  - **A smaller pocket of breathable oxygen.** The opening cavern begins with markedly
    **less** breathable air than the standard start (`specs/gas.md`), so the oxygen
    clock is already short — life support must go up **fast** or the crew suffocates in
    the first cycles.
  - **No starting material.** The colony begins with **zero refined material**
    (`specs/economy.md`), so nothing can be built until the delvers have **dug ore and
    refined it** — the dig→refine chain is the colony's very first work, done against
    the shorter oxygen clock.

Everything else is exactly as the standard start (`specs/modes/survival.md`): the tile
world and digging, the oxygen/CO2 simulation, the power network and machines, the
delvers and their needs, the refine/build/food economy, the controls, and the survival
pressure, scoring, loss state, states, and HUD. Only the **opening air and material**
change — but that change must be **real and felt**: a Deepstart that plays identically
to the standard start (comfortable air, material on hand) has not implemented it.
