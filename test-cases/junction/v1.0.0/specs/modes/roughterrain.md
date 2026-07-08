# Junction — Rough Terrain

This file defines the **Rough Terrain** start, which sits alongside the standard starter
valley. It builds on the standard start in `specs/modes/standard.md` and changes only
the **starting map** — the terrain the city must grow across; everything else is
unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `ROUGH TERRAIN`

Place it after `NEW CITY` and before `HOW TO PLAY`.

## The start

- **Rough Terrain** — the same city and the same systems as the standard start, but on
  a **fragmented map**. Instead of a broad flat valley, the buildable land is broken up
  by **water and hills** (`specs/map.md`): rivers and lakes cut the land into pieces, and
  ridges of hills wall districts off from one another, so contiguous, cheap, connectable
  ground is scarce. Two things follow directly from the terrain (no new systems — just
  the map the common specs already support):
  - **Buildable land is scarce and split.** The player must fit the three zones into
    smaller, separated pockets of buildable ground and connect them, rather than
    sprawling freely.
  - **Carrying transit and utilities across the land costs more.** Because roads, rail,
    wires, and pipes must **span water and hills** to link the pockets (the extra-cost
    bridge/tunnel spans in `specs/map.md`, `specs/transit.md`, `specs/utilities.md`),
    connecting and serving the city eats more of the budget from the first periods — so
    solvency is under pressure earlier and layout matters more.

Everything else is exactly as the standard start (`specs/modes/standard.md`): the zoning
and development, the transit network and congestion, the power and water networks, the
RCI demand, the pollution/land-value feedback, the budget, the controls, and the
growth-and-solvency pressure, scoring, bankruptcy loss state, states, and HUD. Only the
**starting terrain** changes — but that change must be **real and felt**: a Rough
Terrain start that plays on the same open flat valley as the standard start (freely
connectable land, cheap networks) has not implemented it.
