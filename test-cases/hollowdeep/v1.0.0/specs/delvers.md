# Hollowdeep — The delvers: needs, jobs, and pathfinding

This file defines the colonists — the **delvers** — you are keeping alive: their
needs, how they pick up and do work from a job queue, and how they move through the
colony. It builds on the tile world in `specs/world.md`, the air in `specs/gas.md`,
and the work created by `specs/world.md` (digging), `specs/power.md` (operating
generators), and `specs/economy.md` (building, refining, farming).

## The delvers

The colony starts with a small crew — about **3 delvers** — standing in the opening
cavern (`specs/flow.md`; the Deepstart start may differ, `specs/modes/deepstart.md`).
Each is an autonomous worker: you do **not** control a delver directly. You shape
what they do by queuing work and setting priorities (`specs/controls.md`); the
delvers decide who does what and pathfind to it themselves. Each is drawn from its
**produced sprite sheets** and animates through its actions — walk, dig, carry, and
idle (`specs/assets.md`).

## Needs

Each delver tracks a few **needs** that its work and the environment change over
time. When a need is critical, tending it becomes the delver's priority over ordinary
work.

- **Oxygen (health).** Oxygen is not a stored meter but the environmental effect from
  `specs/gas.md`: standing in breathable air is fine; standing in thin oxygen or
  heavy CO2 does **suffocation damage** to the delver's **health**, and breathable air
  lets health recover. A delver in danger will try to **flee to better air** (below)
  rather than keep working. Health reaching zero from suffocation **kills** the
  delver.
- **Stamina.** Work — digging, hauling, building, operating a generator — **drains
  stamina**. A tired delver **rests** (in place or at a built resting spot, your
  choice) to recover it before taking more work. Stamina does not kill a delver; it
  gates how much it can do before resting.
- **Hunger.** Hunger **rises** over time. A hungry delver **eats** from the colony's
  food stock (grown at the fungus farm, `specs/economy.md`) to reset it. A delver that
  cannot eat because the colony has **no food** keeps getting hungrier and eventually
  **starves** — dying, like suffocation, and the colony's other loss path
  (`specs/flow.md`).

Show each delver's needs in the HUD roster (`specs/flow.md`) so the player can see a
delver going hungry, tiring, or losing health before it dies.

## Jobs and the priority queue

Work exists as a **queue of jobs** the colony needs done, and delvers pull from it.

- **Job kinds.** At least: **dig** a marked tile (`specs/world.md`), **build** a
  placed order (`specs/economy.md`), **haul** a resource (move ore/material/food to
  where it is needed — you may fold hauling into the other jobs if your model does not
  need standalone hauls, but state that in the `README`), **operate** a generator
  (`specs/power.md`) if you make generators operated, and **harvest** ripe fungus
  (`specs/economy.md`).
- **Priority.** Jobs have a **priority order** so the colony does the important work
  first, and the player can influence it (`specs/controls.md` — for example a
  per-job-kind priority, or prioritizing a specific designation). A **need** that has
  gone critical (fleeing bad air, resting when exhausted, eating when starving) takes
  precedence over ordinary jobs for that delver.
- **Assignment.** A free delver takes the highest-priority job it can **reach and
  do**, walks to it, performs it (playing the matching animation), and returns to the
  queue for the next. A job that no delver can currently reach waits until the colony
  opens a path to it. Two delvers do not both claim the same job.

The observable behavior the viewer looks for: queue several digs and a couple of
builds and the delvers **divide the work sensibly and get it done**, tending their
own needs when those get critical — not standing idle with work available, and not
all piling onto one tile.

## Pathfinding and movement

Delvers move through the colony on foot; they cannot fly, teleport, or walk through
solid tiles.

- **Walkable tiles.** A delver walks on **floors** and along the **tops of solid
  tiles** (it stands on the surface of the ground), and open space directly above a
  supporting tile. It **cannot** stand in mid-air: to cross a gap or a room with no
  floor it needs a **floor** built across it (`specs/economy.md`).
- **Vertical movement.** A delver climbs a **ladder** to move up or down between
  levels; without a ladder (or a slope of dug tiles it can step up/down by one), it
  **cannot** ascend. Building ladders to reach new digs and levels is a core part of
  shaping the colony. A delver may **fall** down through open space (taking no or
  minor consequence — your choice), but cannot climb back up without a ladder.
- **Pathfinding.** Delvers **pathfind** (a grid path search such as A\* or BFS over
  the walkable/climbable graph) from where they are to the tile a job needs them at
  — including finding the reachable tile **adjacent** to a dig, or the route to a
  build, a generator, the farm, or breathable air. If no path exists, the job or the
  destination is currently unreachable and the delver does something else. Movement
  along the path is continuous and animated; delvers do not jump between tiles
  instantly.
- **Fleeing bad air.** When a delver's tile becomes unbreathable (`specs/gas.md`) it
  pathfinds toward the nearest reachable **breathable** tile as its top priority. If
  it can reach good air it survives; if the colony has sealed or spent all its
  breathable air, it cannot, and it suffocates where it stands — which is how a colony
  dies (`specs/flow.md`).

## Death

A delver **dies** when its health reaches zero (from suffocation, `specs/gas.md`) or
when it **starves** (hunger with no food, above). A dead delver stops working and is
gone from the roster. When the **last** delver dies, the colony is lost
(`specs/flow.md`).
