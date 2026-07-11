# Hollowdeep — The colony start

This file (`specs/mode.md`) defines the playable start and its main-menu entry. It
builds on the tile world in `specs/world.md`, the gas in `specs/gas.md`, power in
`specs/power.md`, the delvers in `specs/delvers.md`, the economy in
`specs/economy.md`, the controls in `specs/controls.md`, and the survival flow in
`specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `NEW COLONY`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **New colony** — the standard survival start. The colony opens with a small crew of
  **delvers** (about **3**, `specs/delvers.md`) in a modest **opening cavern** already
  filled with a **finite pocket of breathable oxygen** (`specs/gas.md`), a **modest
  starting stock of material** on hand so the first buildings can go up without waiting
  on the whole dig→refine chain, and ore seams within reach in the surrounding rock
  (`specs/world.md`). You dig, refine, build, and farm to stand up life support before
  the pocket sours, then hold the colony against its own consumption for as long as you
  can (`specs/flow.md`).

This start uses every system exactly as the common specs define it, with no overrides:

- the **tile world** and **digging** from `specs/world.md`;
- the **oxygen/CO2 gas simulation** — diffusion, buoyancy, breathing, and suffocation
  — from `specs/gas.md`;
- the **power network** and its machines from `specs/power.md`;
- the **delvers**, their needs, the job queue, and pathfinding from `specs/delvers.md`;
- the **refine/build/food economy** from `specs/economy.md`;
- the camera, tools, priorities, and speed controls from `specs/controls.md`;
- and the survival pressure, cycles, scoring, the loss state, the states, and the HUD
  from `specs/flow.md`.
