# Junction — The start

This file defines the city's start: the map the city grows on and the main-menu entry
that begins a game. It builds on the city map in `specs/map.md`, the transit network in
`specs/transit.md`, the utilities in `specs/utilities.md`, the economy in
`specs/economy.md`, the controls in `specs/controls.md`, and the flow in
`specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `NEW CITY`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **New city** — the map is a **mostly flat, buildable valley**: broad open land, a
  river or lake somewhere on it (a water source and an amenity, `specs/map.md`), and
  perhaps a low hill or two — but plenty of cheap, connectable ground to grow across.
  The city opens with a **modest starting treasury** (enough to lay the first roads, a
  power plant, a water source, and the first zones without waiting), a **short length of
  pre-placed starting road** (or a highway stub) to build out from so the player is not
  staring at empty land, and the RCI demands already positive so zoning develops from
  the first periods. You zone, connect, and serve land to grow the city and hold it
  solvent for as long as you can (`specs/flow.md`).

The start uses every system as the common specs define it:

- the **tile map**, **terrain**, and **zoning/development** from `specs/map.md`;
- the **transit network** — roads, rail, stations, pathing, and congestion — from
  `specs/transit.md`;
- the **power and water networks** from `specs/utilities.md`;
- the **RCI demand**, the **pollution/land-value** feedback, and the **budget** from
  `specs/economy.md`;
- the camera, tools, overlays, and speed controls from `specs/controls.md`;
- and the growth-and-solvency pressure, the clock, scoring, the bankruptcy loss state,
  the states, and the HUD from `specs/flow.md`.
