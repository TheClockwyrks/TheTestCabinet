# Holdfast — Controls: camera, tools, the work grid, and speed

This file defines how the player interacts with the colony: the simulation step, the
camera, the designation and build tools, the work-priority grid, and the speed and pause
controls. The player does not control settlers directly (`specs/settlers.md`) — they
command the colony through designations and settings, and the settlers carry them out.

## Simulation

Run the simulation on a **fixed timestep** — the **tick** — decoupled from rendering,
so pathfinding, work, farming, combat resolution, and the day/night clock are
reproducible and do not depend on the render frame rate. A modest rate (for example a
handful of ticks per second for the colony sim, with smooth interpolated rendering
between) is plenty; do not tie the tick to the display refresh. The **speed controls**
(below) scale how many ticks pass per real second; **pause** halts ticks entirely.

## The camera

The colony view (`y` in `[64, 656]`) is a camera looking down on the larger world
(`specs/world.md`):

- **Pan** the camera with the **arrow keys** or **`W` / `A` / `S` / `D`**, and/or by
  dragging with the mouse and/or an edge-scroll near the view's edges — support at
  least one keyboard pan and one mouse pan. The camera is **clamped to the world
  bounds** so it never scrolls past the sealed edges.
- A modest **zoom** (mouse wheel) is **required**. It must keep the whole
  stage fitted and the HUD strips fixed (`specs/overview.md`).
- Panning and zooming never pause or otherwise change the simulation.

## Tools

The player acts on the world through a small set of **tools**, chosen from the build
palette in the bottom HUD (`specs/flow.md`). Exactly one tool is active at a time; its
cursor/preview makes the current tool obvious.

- **Designate tool (chop / mine).** Marks a **resource node** — a tree to chop or an
  ore vein to mine (`specs/world.md`) — for work. Click a node to mark it, and **drag**
  to mark a rectangle or run of nodes at once. Marked nodes show a clear **designation
  overlay**. (You may split this into separate chop and mine tools, or one designate
  tool that reads the node under it — state which in the `README`.)
- **Build tool.** With a **structure selected** (wall, door, floor, bed, stove, farm
  plot, turret — `specs/economy.md`, `specs/combat.md`), click (or drag) to place its
  **ghost/blueprint** on legal target tiles; the ghost shows the pending build and its
  material cost. Illegal placements are refused clearly.
- **Cancel / deconstruct tool.** Clears a designation or a build ghost, and (your
  choice) queues deconstruction of a finished structure. Cancelling a designation just
  removes the job (`specs/world.md`, `specs/economy.md`).
- **Priority.** Provide a way to influence **what the colony does first and who does
  what** — the **work-priority grid** below. Keep it real: the player must be able to
  say "this colonist mines, that one cooks" or "builds before hauls" and see the
  settlers respond.

Selecting a tool or structure, and reading the palette, is done from the bottom HUD
(`specs/flow.md`). A tool stays active until another is chosen, so the player can mark
many tiles in a row.

## The work-priority grid

The colony's labor is assigned through a **work-priority grid** — a small panel (opened
from the HUD; `specs/flow.md`) with **one row per settler** and **one column per work
type** (chop/mine, haul, build, cook, farm, fight — `specs/settlers.md`). Each cell sets
that settler's priority for that work (a small ordered priority, or at least on/off).
Settlers pull jobs respecting the grid (`specs/settlers.md`), so the player uses it to
put the right colonist on the right work and to set what the colony does first. Keep the
grid legible and quick to set; it is the primary way the player manages the crew.

## Speed and pause

The colony runs in real time, but the player controls its pace:

- **Pause / resume.** `Space` (or a HUD button) **pauses** the simulation — ticks stop,
  the field freezes — and resumes it. Paused, the player can still pan, read the HUD,
  set the work grid, and place designations and ghosts (they simply do not progress
  until resumed). This is distinct from the **Paused menu** (`specs/flow.md`), the full
  overlay menu reached with `Esc`.
- **Speed.** Offer at least a **normal** and a **fast** speed (for example `1` and
  `2` / `3` keys, or HUD buttons) that scale how many ticks pass per second, so the
  player can fast-forward the quiet stretches and slow down for a raid. The current
  speed is shown in the HUD.
- **Menu / back.** `Esc` opens the **Paused** overlay menu (Resume / Restart / Quit to
  menu, `specs/flow.md`); in a menu, `Esc` goes back.
- **Menus.** In the title, how-to-play, pause, and colony-lost screens, the pointer
  and/or `Up` / `Down` (or `W` / `S`) move the selection and `Enter` / `Space`
  confirms (`specs/flow.md`).

Keyboard and mouse only; no touch or gamepad for this version (`specs/flow.md`).
