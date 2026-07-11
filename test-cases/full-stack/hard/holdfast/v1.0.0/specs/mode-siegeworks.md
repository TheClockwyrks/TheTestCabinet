# Holdfast — Siegeworks start

This file defines the playable start. It builds on the tile world in `specs/world.md`,
the settlers in `specs/settlers.md`, the economy in `specs/economy.md`, combat in
`specs/combat.md`, the day/night cycle in `specs/time.md`, the controls in
`specs/controls.md`, and the survival flow in `specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `SIEGEWORKS`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **Siegeworks** — a frontier survival start under a **heavier siege**. The colony
  opens with a small crew of **settlers** (about **3**, `specs/settlers.md`) at a
  **landing site** on open ground, with a **modest starting stock of wood and a few
  meals** on hand so the first buildings can go up and the crew can eat while the farm
  and stove are stood up, and with tree stands and ore veins within reach in the
  surrounding land (`specs/world.md`). You gather, build, farm, and defend to stand up
  walls, food, and turrets before the raids escalate, then hold the colony together for
  as long as you can (`specs/flow.md`).

The colony and its systems are exactly as the common specs define them:

- the **tile world** and **resource nodes** from `specs/world.md`;
- the **settlers**, their needs and mood, skills, the job queue, and pathfinding from
  `specs/settlers.md`;
- the **gather/build/cook/farm economy** from `specs/economy.md`;
- the **threat director** and **ranged combat** from `specs/combat.md`;
- the **day/night cycle** from `specs/time.md`;
- the camera, tools, the work-priority grid, and speed controls from
  `specs/controls.md`;
- and the survival pressure, days, scoring, the loss state, the states, and the HUD from
  `specs/flow.md`.

## The threat: a heavier siege

Only the **raids** press harder than an ordinary frontier start, and the difference must
be **real and felt**. Two things change about the threat director (`specs/combat.md`):

- **Bigger raids.** Each raid arrives **markedly larger and stronger**, on the same
  tightening timer — so a defense that would hold an ordinary raid is overrun, and the
  colony must build deeper defenses (more walls, more turrets, more armed shooters) and
  actually win the fights.
- **Sappers that break walls.** Raids include **sappers** — raiders that **attack and
  destroy the colony's walls** (`specs/economy.md`, `specs/combat.md`) to punch through
  to the settlers, rather than only shooting from the open. So a single static wall ring
  is **not** a safe answer: the colony must layer defenses, cover the approaches with
  fire, and repel the raid, not merely hide behind one wall.

A Siegeworks that plays like an ordinary frontier start — same raid size, no
wall-breaking — has not implemented it.
