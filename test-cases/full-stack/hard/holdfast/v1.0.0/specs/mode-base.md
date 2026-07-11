# Holdfast — The standard frontier start

This file defines the playable start. It builds on the tile world in
`specs/world.md`, the settlers in `specs/settlers.md`, the economy in `specs/economy.md`,
combat in `specs/combat.md`, the day/night cycle in `specs/time.md`, the controls in
`specs/controls.md`, and the survival flow in `specs/flow.md`.

## Menu entry

This start adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `NEW COLONY`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **New colony** — the standard survival start. The colony opens with a small crew of
  **settlers** (about **3**, `specs/settlers.md`) at a **landing site** on open ground,
  with a **modest starting stock of wood and a few meals** on hand so the first
  buildings can go up and the crew can eat while the farm and stove are stood up, and
  with tree stands and ore veins within reach in the surrounding land (`specs/world.md`).
  You gather, build, farm, and defend to stand up walls, food, and turrets before the
  raids escalate, then hold the colony together against attacks that keep growing, for as
  long as you can (`specs/flow.md`).

This start uses every system exactly as the common specs define it, with no
overrides:

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

## The threat

The raids follow the standard escalating curve of the threat director
(`specs/combat.md`): they scale with the colony's age and wealth on a tightening timer,
each raid announced before it lands. The raiders **shoot from the open** and take cover
like the settlers do; they come for the settlers and their turrets, but they **do not
break through the colony's walls** — a well-built wall line, covered by fire, holds them
off. The challenge is to stand up that defensive ground, and keep the crew fed and
rested to man it, faster than the raids grow.
