# Junction — Controls: camera, tools, overlays, and speed

This file defines how the player interacts with the city: the simulation step, the
camera, the zone/road/rail/utility/bulldoze tools, the data overlays, and the speed and
pause controls. The player shapes the city through zoning and building; the simulation
develops and runs it (`specs/map.md`, `specs/economy.md`).

## Simulation

Run the simulation on a **fixed timestep** — the **tick** — decoupled from rendering,
so demand, traffic assignment and congestion, utility balance, development/abandonment,
pollution spread, and the budget are reproducible and do not depend on the render frame
rate. A modest rate (for example a handful of ticks per second for the city sim, with
smooth interpolated rendering — moving vehicles, growing buildings — between) is plenty;
do not tie the tick to the display refresh. The **speed controls** (below) scale how
many ticks pass per real second; **pause** halts ticks entirely.

## The camera

The city view (`y` in `[64, 656]`) is a top-down camera onto the larger map
(`specs/map.md`):

- **Pan** the camera with the **arrow keys** or **`W` / `A` / `S` / `D`**, and/or by
  dragging with the mouse and/or an edge-scroll near the view's edges — support at least
  one keyboard pan and one mouse pan. The camera is **clamped to the map bounds** so it
  never scrolls past the edges.
- A modest **zoom** (mouse wheel) is optional. If included it must keep the whole stage
  fitted and the HUD strips fixed (`specs/overview.md`).
- Panning and zooming never pause or otherwise change the simulation.

## Tools

The player acts on the map through a set of **tools**, chosen from the build palette in
the bottom HUD (`specs/flow.md`). Exactly one tool is active at a time; its
cursor/preview and a running **cost readout** make the current tool and what it will
charge obvious. A tool stays active until another is chosen, so the player can paint or
lay many tiles in a row.

- **Zone tools — Residential / Commercial / Industrial.** Paint buildable tiles with a
  zone kind (`specs/map.md`). Click a tile to zone it, and **drag** to zone a rectangle
  or run at once. Only buildable land can be zoned (water and hills are refused clearly,
  `specs/map.md`). Re-zoning a tile changes its kind; already-developed tiles resist
  re-zoning or must be cleared first (your choice; state it in the `README`).
- **Road tool.** Lay road tiles (`specs/transit.md`), click or drag a run. Crossing
  water or a hill places a bridge/tunnel span at extra cost (`specs/map.md`), shown in
  the cost readout.
- **Rail tool + Station tool.** Lay rail/metro line tiles and place stations on the line
  (`specs/transit.md`). Stations must sit where citizens can reach them (on/adjacent to
  the road network).
- **Power tools — Plant + Wire.** Place a power plant and lay power lines
  (`specs/utilities.md`).
- **Water tools — Source + Pipe.** Place a water source (on/beside water) and lay pipes
  (`specs/utilities.md`).
- **Bulldoze tool.** Removes a zone, road, rail, station, wire, pipe, plant, source, or
  clears a developed building (your choice on partial refunds; state it in the
  `README`). Bulldozing a link can cut off the tiles that depended on it, which then
  lose access/service and abandon (`specs/map.md`).
- **Tax / rate control.** A way to set the **tax rate** (`specs/economy.md`) — a
  slider/stepper in the HUD or a panel — so the player can trade income against demand.

Illegal placements (zoning water, a road with no funds, a station off the network,
etc.) are **refused clearly**; a build the treasury cannot afford is refused or warned
(state which in the `README`).

## Overlays

Provide toggleable **data overlays** on the city view so the player can read the
invisible systems (all drawn **in code**, `specs/assets.md`):

- **Traffic overlay** — per-link load vs. capacity, coloring clear → gridlock
  (`specs/transit.md`). This one is important; the congestion is a core read.
- **Utility overlay(s)** — served vs. unserved tiles and the power/water networks
  (`specs/utilities.md`).
- **Pollution and/or land-value overlay** — the `specs/economy.md` fields.

At least the **traffic** overlay is required; the others are strongly encouraged. The
base map view (with the produced pollution haze always visible, `specs/assets.md`) is
the default; overlays are opt-in toggles.

## Speed and pause

The city runs in real time, but the player controls its pace:

- **Pause / resume.** `Space` (or a HUD button) **pauses** the simulation — ticks stop,
  the city freezes — and resumes it. Paused, the player can still pan, read the HUD,
  toggle overlays, and place zones and builds (they simply do not progress until
  resumed). This is distinct from the **Paused menu** (`specs/flow.md`), the full
  overlay menu reached with `Esc`.
- **Speed.** Offer at least a **normal** and a **fast** speed (for example `1` and `2` /
  `3` keys, or HUD buttons) that scale how many ticks pass per second, so the player can
  fast-forward the slow growth stretches and slow down for a crisis. The current speed
  is shown in the HUD.
- **Menu / back.** `Esc` opens the **Paused** overlay menu (Resume / Restart / Quit to
  menu, `specs/flow.md`); in a menu, `Esc` goes back.
- **Menus.** In the title, how-to-play, pause, and bankruptcy screens, the pointer
  and/or `Up` / `Down` (or `W` / `S`) move the selection and `Enter` / `Space` confirms
  (`specs/flow.md`).

Keyboard and mouse only; no touch or gamepad for this version (`specs/flow.md`).
