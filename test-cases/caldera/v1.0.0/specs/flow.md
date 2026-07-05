# Caldera — Flow, states, controls, and HUD

This file defines the game-state machine, the screens, the camera and build
controls, and the HUD (including the **fluid-network overlay**, the wireframe
toggle, and the performance overlay). It refers to the world in `specs/world.md`,
the economy and building in `specs/build.md`, the fluids in `specs/fluids.md`, the
towers in `specs/towers.md`, the Slag in `specs/enemies.md`, and the wave loop in
`specs/waves.md`. Use the palette and monospace type from `specs/overview.md`
throughout.

## Winning and losing

Caldera is **won or lost** (`specs/waves.md`). Clearing the **final wave** with the
Core still standing goes to the **held** (victory) end screen; the Core's health
reaching `0` at any point goes to the **overrun** (defeat) end screen.

## Game states

The build is a small state machine. Each state has a clear screen and controls.

1. **Title.** The screen shown **on load**. It presents the game title `CALDERA`, a
   tagline, and exactly two options:
   - **PLAY** — opens the **starting-wave** prompt (below), then starts the run.
   - **HOW TO PLAY** — opens a controls/how-to screen (below), which returns to the
     title.
   This screen is **static on load** (it does not animate a live world behind it in a
   way that changes what a screenshot shows), so it is the deterministic view the
   harness checks.
2. **Starting-wave prompt.** Reached from **PLAY**. Lets the player begin at **wave 1**
   or **skip ahead** to a later wave (`specs/waves.md`), with wave 1 the default and a
   short note that a later start drops straight into the tougher assault with a scaled
   treasury. Confirming enters the run at that wave; a back/cancel returns to the title.
3. **How to play.** Reached from **HOW TO PLAY**. A static panel listing the controls
   (below) and a brief primer on the loop — that the Core produces funds and can be
   upgraded; that you draw water, boil it to steam on vents, and pipe steam to towers
   that only fire when supplied; that the Slag come from two breaches and you win by
   clearing all the waves. Returns to the title.
4. **In game.** The live game on the world from `specs/world.md`, viewed through the
   tilted RTS camera (`specs/overview.md`): you build and defend, the Slag assault, the
   HUD below. This is where the world, economy, fluids, towers, Slag, and wave loop all
   play out. Building, the wave loop, and the survival clock all run here.
5. **Paused.** Reachable in game (`Esc` / `P`). Offers **Resume**, **Restart**, and
   **Quit to title**. The world is visible but the **simulation and the survival clock
   are frozen** behind the menu.
6. **Held (victory).** Shown when the final wave is cleared with the Core alive.
   Displays a victory line (e.g. `THE CALDERA HOLDS`), the **waves survived**, **Slag
   destroyed**, **time**, and **funds** earned, with options to **DEFEND AGAIN**
   (restart at the same starting wave) and **RETURN** (to the title).
7. **Overrun (defeat).** Shown when the Core falls. Displays a defeat line (e.g. `THE
   CORE IS LOST`), the **wave reached**, **Slag destroyed**, and **time**, with the
   same two options. Both end screens share the layout of `reference/game-over.png`,
   recolored by result.

Every state must be reachable and behave as described.

## Controls

The game is driven by the mouse over the tilted 3D world plus keyboard shortcuts;
menus accept mouse and keyboard.

- **Camera pan:** `W`/`A`/`S`/`D` or the arrow keys, drag with the middle mouse
  button, or push the screen edges. **Rotate:** `Q`/`E` or drag with the right mouse
  button. **Zoom:** the scroll wheel. The camera stays tilted (never straight
  top-down) and keeps the terrain relief legible (`specs/overview.md`).
- **Select / inspect:** left-click a cell or a structure to select it; the **selection
  panel** (below) shows what is there (terrain type and elevation, or the structure's
  stats and health) and its actions (upgrade / repair / demolish where applicable).
- **Build:** pick a structure from the **build palette** (a hotbar; number keys `1…9`
  or click select it), then hover the world to see **live valid/invalid** placement
  feedback (`specs/build.md`) — valid cells tinted in the placement-valid color,
  invalid in the invalid color with a short reason (e.g. "needs a vent", "across a
  cliff", "not enough funds"). **Left-click** to place. **Pipes** lay by **click-drag**
  across a run of cells, the path snapping to terrace-legal edges and stopping at a
  cliff (`specs/build.md`). `Esc` or right-click cancels the current build tool.
- **Upgrade / repair / demolish:** with a structure selected, keys or on-panel buttons
  trigger its actions (`specs/build.md`).
- **Game speed:** a **pause/play** toggle and a **fast-forward** (e.g. `1×` / `2×`)
  toggle, bound to keys (state them on the how-to screen — e.g. `Space` pause, `F`
  fast-forward) and shown on the HUD. Fast-forward speeds the whole simulation; it must
  stay **frame-rate independent** (`specs/overview.md`) — `2×` runs the sim twice as
  fast, not twice as choppy.
- **Toggles:** the **fluid-network overlay**, **wireframe mode**, and the
  **performance overlay** each have a key (state them on the how-to line or a hint —
  e.g. `V` overlay, `F4` wireframe, `F3` performance).
- **Pause menu:** `Esc` (or `P`). Menus: the mouse selects and clicks; arrow keys or
  `W`/`S` move the selection and `Enter`/`Space` confirm.

A brief controls hint must be available (on the title screen, the **HOW TO PLAY**
screen, and/or the pause menu) so a first-time player can find these.

## HUD

Drawn as an overlay over the 3D world in the palette and monospace type from
`specs/overview.md`. All HUD elements must stay on screen, fitted and legible, at any
window size and pixel density, including on load. The HUD shows, at minimum:

- **Funds** — the current balance and the live **income rate** (`+$/s`), in the funds
  color, with the **Core upgrade** control/level (`specs/build.md`).
- **Core status** — the Core's **health bar** (`specs/world.md`), healthy → critical by
  fraction, so the player can watch the objective. An alert when the Core is under
  attack.
- **Wave status** — the current wave and count (`WAVE 6 / 15`), the build-interval
  **countdown**, and — during a build interval — a **preview of the next wave's
  composition** (`specs/waves.md`): which archetypes and roughly which tiers are coming.
- **Steam supply** — a compact **steam produced-vs-demanded** readout (`specs/fluids.md`)
  so the player can see at a glance whether the network is over-subscribed, without
  opening the full overlay.
- **Build palette** — the hotbar of buildables (`specs/build.md`) with costs, each
  greyed when unaffordable.
- **Selection panel** — the currently selected cell or structure: for a cell, its
  terrain type and **elevation**; for a structure, its stats, health, and actions.
- **Alerts** — brief callouts: a network line severed, a tower browning out, the Core
  under attack, a wave incoming/cleared, and the run held/overrun.

### Fluid-network overlay

A toggleable **fluid-network overlay** (default off, bound to a key — e.g. `V`) is the
signature tool. When on, it paints both networks over the world (`specs/fluids.md`):

- the **water** network (in the water-pipe color) and the **steam** network (in the
  steam-pipe color), with **flow direction and rate** along the lines,
- each **source**'s and **boiler**'s current rate, and each **tower**'s state —
  **powered**, **brownout**, or **dark**,
- **over-subscribed** steam segments and **severed** lines flagged.

It exists so a player can debug the grid and so the fluid simulation is inspectable.
Toggling it must not disturb the simulation.

### Performance overlay

A toggleable **performance overlay** (default off, bound to a key — e.g. `F3`) shows at
least the live **FPS**, and ideally the draw count and on-screen unit count. It exists
so the required frame rate (`specs/overview.md`) is observable during a heavy late-wave
assault. Keep it small, in a corner, in the faint/secondary text colors.

### Wireframe mode

A toggleable **wireframe mode** (default off, bound to a key — e.g. `F4`) renders the
scene as wireframe — **both** the terrain (the hex mesh with its terraces and cliffs)
**and** the structure/unit geometry — so the generated geometry is inspectable
(`specs/overview.md`). Toggling it must not disturb the simulation.

## Audio

Audio is recommended but optional, and must never be required for the game to run or
load. If included, synthesize it with the Web Audio API (no audio files): short
distinct cues for placing a structure, a tower firing, a boiler venting steam, a line
severed, a Slag destroyed, a wave incoming, the Core under attack, and the held/overrun
stings. Provide a mute toggle, and do not start audio until the player interacts
(browsers block autoplay).

## Out of scope

- Network or online multiplayer — the Slag are all local AI.
- **Destructible or editable terrain** (`specs/world.md`): the player never raises,
  lowers, carves, or reshapes cells; the terrain is fixed at generation. There is no
  terrain editor.
- A campaign, a tech tree, or persistence of progress or settings between sessions.
- Additional structures, towers, or Slag archetypes beyond those in `specs/build.md`,
  `specs/towers.md`, and `specs/enemies.md` — escalation is by wave composition and
  tier (`specs/waves.md`), not a larger roster.
- Unit micro: you do not command individual soldiers or the Slag; you build and defend,
  and the towers and Slag act autonomously.
