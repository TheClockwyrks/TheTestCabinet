# Hollowdeep — Controls: camera, tools, priorities, and speed

This file defines how the player interacts with the colony: the simulation step, the
camera, the dig and build tools, priorities, and the speed and pause controls. The
player does not control delvers directly (`specs/delvers.md`) — they command the
colony through designations and settings, and the delvers carry them out.

## Simulation

Run the simulation on a **fixed timestep** — the **tick** — decoupled from rendering,
so gas diffusion, delver work, growth, and power balance are reproducible and do not
depend on the render frame rate. A modest rate (for example a handful of ticks per
second for the colony sim, with smooth interpolated rendering between) is plenty; do
not tie the tick to the display refresh. The **speed controls** (below) scale how
many ticks pass per real second; **pause** halts ticks entirely.

## The camera

The colony view (`y` in `[64, 656]`) is a camera onto the larger world
(`specs/world.md`):

- **Pan** the camera with the **arrow keys** or **`W` / `A` / `S` / `D`**, and/or by
  dragging with the mouse and/or an edge-scroll near the view's edges — support at
  least one keyboard pan and one mouse pan. The camera is **clamped to the world
  bounds** so it never scrolls past the sealed edges.
- A modest **zoom** (mouse wheel) is optional. If included it must keep the whole
  stage fitted and the HUD strips fixed (`specs/overview.md`).
- Panning and zooming never pause or otherwise change the simulation.

## Tools

The player acts on the world through a small set of **tools**, chosen from the build
palette in the bottom HUD (`specs/flow.md`). Exactly one tool is active at a time;
its cursor/preview makes the current tool obvious.

- **Dig tool.** Marks solid (non-bedrock) tiles for digging (`specs/world.md`).
  Click a tile to mark it, and **drag** to mark a rectangle or run of tiles at once.
  Marked tiles show the dig designation. Bedrock cannot be marked.
- **Build tool.** With a **building selected** (wall, floor, ladder, wire, a machine,
  the farm — `specs/economy.md`, `specs/power.md`), click (or drag) to place its
  **ghost/blueprint** on legal target tiles; the ghost shows the pending build and
  its material cost. Illegal placements are refused clearly.
- **Cancel/deconstruct tool.** Clears a dig designation or a build ghost, and (your
  choice) queues deconstruction of a finished building. Cancelling a designation just
  removes the job (`specs/world.md`, `specs/economy.md`).
- **Priority.** Provide a way to influence **what the colony does first**
  (`specs/delvers.md`) — for example toggling the priority of a job kind, or raising
  the priority of a specific designation. Keep it simple but real: the player must be
  able to say "dig this now" or "builds before digs" and see the delvers respond.

Selecting a tool or building, and reading the palette, is done from the bottom HUD
(`specs/flow.md`). A tool stays active until another is chosen, so the player can
mark many tiles in a row.

## Speed and pause

The colony runs in real time, but the player controls its pace:

- **Pause / resume.** `Space` (or a HUD button) **pauses** the simulation — ticks
  stop, the field freezes — and resumes it. Paused, the player can still pan, read the
  HUD, and place designations and ghosts (they simply do not progress until resumed).
  This is distinct from the **Paused menu** (`specs/flow.md`), which is the full
  overlay menu reached with `Esc`.
- **Speed.** Offer at least a **normal** and a **fast** speed (for example `1` and `2`
  / `3` keys, or HUD buttons) that scale how many ticks pass per second, so the player
  can fast-forward the slow stretches and slow down for a crisis. The current speed is
  shown in the HUD.
- **Menu / back.** `Esc` opens the **Paused** overlay menu (Resume / Restart / Quit
  to menu, `specs/flow.md`); in a menu, `Esc` goes back.
- **Menus.** In the title, how-to-play, pause, and colony-lost screens, the pointer
  and/or `Up` / `Down` (or `W` / `S`) move the selection and `Enter` / `Space`
  confirms (`specs/flow.md`).

Keyboard and mouse only; no touch or gamepad for this version (`specs/flow.md`).
