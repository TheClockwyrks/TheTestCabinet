# Junction — The start

This file defines the city's start: the map the city grows on and the main-menu entry
that begins a game. It builds on the city map in `specs/map.md`, the transit network in
`specs/transit.md`, the utilities in `specs/utilities.md`, the economy in
`specs/economy.md`, the controls in `specs/controls.md`, and the flow in
`specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `ROUGH TERRAIN`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **Rough Terrain** — the city grows on a **fragmented map**. Instead of a broad flat
  valley, the buildable land is broken up by **water and hills** (`specs/map.md`):
  rivers and lakes cut the land into pieces, and ridges of hills wall districts off from
  one another, so contiguous, cheap, connectable ground is scarce. The city opens with a
  **modest starting treasury** (enough to lay the first roads, a power plant, a water
  source, and the first zones without waiting), a **short length of pre-placed starting
  road** (or a highway stub) to build out from so the player is not staring at empty
  land, and the RCI demands already positive so zoning develops from the first periods.
  Two things follow directly from the terrain (no new systems — just the map the common
  specs already support):
  - **Buildable land is scarce and split.** The player must fit the three zones into
    smaller, separated pockets of buildable ground and connect them, rather than
    sprawling freely.
  - **Carrying transit and utilities across the land costs more.** Because roads, rail,
    wires, and pipes must **span water and hills** to link the pockets (the extra-cost
    bridge/tunnel spans in `specs/map.md`, `specs/transit.md`, `specs/utilities.md`),
    connecting and serving the city eats more of the budget from the first periods — so
    solvency is under pressure earlier and layout matters more.

The start uses every other system as the common specs define it:

- the **tile map**, **terrain**, and **zoning/development** from `specs/map.md`;
- the **transit network** — roads, rail, stations, pathing, and congestion — from
  `specs/transit.md`;
- the **power and water networks** from `specs/utilities.md`;
- the **RCI demand**, the **pollution/land-value** feedback, and the **budget** from
  `specs/economy.md`;
- the camera, tools, overlays, and speed controls from `specs/controls.md`;
- and the growth-and-solvency pressure, the clock, scoring, the bankruptcy loss state,
  the states, and the HUD from `specs/flow.md`.

The fragmented terrain must be **real and felt**: a start that plays on an open flat
valley with freely connectable land and cheap networks has not implemented it.
