# Hollowdeep — Deepstart

This file (`specs/mode.md`) defines the playable start and its main-menu entry. It is
the standard Hollowdeep colony — the same systems and the same goal — **opened scarce**:
the colony begins with markedly less breathable air and no refined material, so it is
under survival pressure from the first cycle. It builds on the tile world in
`specs/world.md`, the gas in `specs/gas.md`, power in `specs/power.md`, the delvers in
`specs/delvers.md`, the economy in `specs/economy.md`, the controls in
`specs/controls.md`, and the survival flow in `specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `DEEPSTART`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **Deepstart** — the colony opens with a small crew of **delvers** (about **3**,
  `specs/delvers.md`) in a modest **opening cavern**, with ore seams within reach in the
  surrounding rock (`specs/world.md`). You dig, refine, build, and farm to stand up life
  support before the air sours, then hold the colony against its own consumption for as
  long as you can (`specs/flow.md`). Two things about the opening are **scarce**:
  - **A smaller pocket of breathable oxygen.** The opening cavern begins with markedly
    **less** breathable air than a comfortable start would give (`specs/gas.md`), so the
    oxygen clock is already short — life support must go up **fast** or the crew
    suffocates in the first cycles.
  - **No starting material.** The colony begins with **zero refined material**
    (`specs/economy.md`), so nothing can be built until the delvers have **dug ore and
    refined it** — the dig→refine chain is the colony's very first work, done against
    the shorter oxygen clock.

This start uses every system exactly as the common specs define it, with no overrides
beyond the opening air and material above:

- the **tile world** and **digging** from `specs/world.md`;
- the **oxygen/CO2 gas simulation** — diffusion, buoyancy, breathing, and suffocation
  — from `specs/gas.md`;
- the **power network** and its machines from `specs/power.md`;
- the **delvers**, their needs, the job queue, and pathfinding from `specs/delvers.md`;
- the **refine/build/food economy** from `specs/economy.md`;
- the camera, tools, priorities, and speed controls from `specs/controls.md`;
- and the survival pressure, cycles, scoring, the loss state, the states, and the HUD
  from `specs/flow.md`.

The scarce opening must be **real and felt**: a colony that opens with comfortable air
and material on hand has not implemented this start.
