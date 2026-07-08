# Midway — Controls: camera, tools, prices, and speed

This file defines how the player interacts with the park: the simulation step, the
camera, the path/build/staff/price tools, and the speed and pause controls. The
player does not control guests or staff directly (`specs/guests.md`,
`specs/staff.md`) — they shape the park through what they build, hire, and price,
and the crowd and workers act on it.

## Simulation

Run the simulation on a **fixed timestep** — the **tick** — decoupled from
rendering, so guest movement, queues, ride runs, breakdowns, spending, and the day
clock are reproducible and do not depend on the render frame rate. A modest rate
(for example a handful of ticks per second, with smooth interpolated rendering
between) is plenty; do not tie the tick to the display refresh. The **speed
controls** (below) scale how many ticks pass per real second; **pause** halts ticks
entirely.

## The camera

The park view (`y` in `[64, 656]`) is a camera onto the larger plot
(`specs/park.md`):

- **Pan** the camera with the **arrow keys** or **`W` / `A` / `S` / `D`**, and/or by
  dragging with the mouse and/or an edge-scroll near the view's edges — support at
  least one keyboard pan and one mouse pan. The camera is **clamped to the plot
  bounds** so it never scrolls past the fence.
- A modest **zoom** (mouse wheel) is optional. If included it must keep the whole
  stage fitted and the HUD strips fixed (`specs/overview.md`).
- Panning and zooming never pause or otherwise change the simulation.

## Tools

The player acts on the park through a small set of **tools**, chosen from the build
palette in the bottom HUD (`specs/flow.md`). Exactly one tool is active at a time;
its cursor/preview makes the current tool obvious, and a tool stays active until
another is chosen so the player can work in a run.

- **Path tool.** Lays path onto grass (`specs/park.md`). Click a tile to lay one, and
  **drag** to lay a run or block at once; the preview shows the pending path and its
  cost. Illegal tiles (water, fence, occupied) are refused.
- **Build tool.** With a **ride, stall, or scenery selected** (`specs/rides.md`,
  `specs/park.md`), click to place its **ghost** on legal grass with its entrance on a
  path; the ghost shows the footprint and its cost, red where placement is illegal or
  unaffordable, and clicking a legal spot buys and places it (`specs/economy.md`).
- **Staff tool.** Hire a **janitor, mechanic, or entertainer** (`specs/staff.md`) and
  place it, and assign an already-hired worker to a zone or set it roaming — the model
  you chose in `specs/staff.md`.
- **Price / manage tool.** Click a ride or stall to open its panel and **set its
  price** (`specs/economy.md`), see its queue and recent takings, and click a guest to
  **inspect** its desires and happiness (`specs/guests.md`). Set the **admission
  price** from here or the HUD.
- **Demolish / cancel tool.** Clears a path tile back to grass, or removes a placed
  ride/stall/scenery (`specs/park.md`); refunds are your choice (state them in the
  `README`). Guests on a removed path reroute.

Selecting a tool or a build item, and reading the palette, is done from the bottom
HUD (`specs/flow.md`).

## Speed and pause

The park runs in real time, but the player controls its pace:

- **Pause / resume.** `Space` (or a HUD button) **pauses** the simulation — ticks
  stop, the park freezes — and resumes it. Paused, the player can still pan, read the
  HUD, and lay path, place ghosts, and set prices (they simply do not take effect on
  the crowd until resumed). This is distinct from the **Paused menu**
  (`specs/flow.md`), the full overlay reached with `Esc`.
- **Speed.** Offer at least a **normal** and a **fast** speed (for example `1` and `2`
  / `3` keys, or HUD buttons) that scale how many ticks pass per second, so the player
  can fast-forward the quiet stretches and slow down for a crisis. The current speed
  is shown in the HUD.
- **Menu / back.** `Esc` opens the **Paused** overlay menu (Resume / Restart / Quit to
  menu, `specs/flow.md`); in a menu, `Esc` goes back.
- **Menus.** In the title, how-to-play, pause, and park-closed screens, the pointer
  and/or `Up` / `Down` (or `W` / `S`) move the selection and `Enter` / `Space`
  confirms (`specs/flow.md`).

Keyboard and mouse only; no touch or gamepad for this version (`specs/flow.md`).
