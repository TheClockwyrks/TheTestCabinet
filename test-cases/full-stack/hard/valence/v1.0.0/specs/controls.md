# Valence — Controls

This file defines how the player interacts with the board: the simulation step, building
and inspecting towers on the build grid, starting rounds, and the speed and pause
controls. It builds on the board and its build grid in `specs/board.md`, the towers in
`specs/towers.md`, and the flow in `specs/flow.md`. Keyboard and mouse only; no touch or
gamepad for this version.

## Simulation

Run the simulation on a **fixed timestep** — the **tick** — decoupled from rendering, so
matter movement, tower fire, decomposition, and the economy are reproducible and do not
depend on the render frame rate. Render with smooth interpolation between ticks. The
**speed controls** (below) scale how many ticks pass per real second; **pause** halts
ticks entirely.

## Building and inspecting towers

The player builds by placing towers on the board's **build grid** (`specs/board.md`):

- **Build.** Choose a tower in the shop (click its entry, or press its **hotkey** —
  `1`–`7` for the seven towers in shop order) to enter build mode for that type; the
  cursor then shows the held tower snapped to the cell under the pointer and its **range
  ring**, and the legal empty cells are highlighted. Click an **empty cell** to build it
  there, spending its cost (`specs/towers.md`, `specs/flow.md`). Building is refused
  (clearly) on an occupied or conduit-blocked cell or when you cannot afford it. Build
  mode stays active so you can place several of a type in a row; `Esc` or right-click
  leaves build mode.
- **Select.** Click a **built tower** (or its cell) to select it. The selected tower shows
  its **range ring**, and the build-panel inspector shows its type, tier and branch, live
  stats, and its **upgrade** and **sell** controls (`specs/board.md`, `specs/towers.md`).
- **Upgrade / sell.** With a tower selected, **upgrade** it (the inspector's control, or
  press `U`) or **sell** it (the inspector's control, or press `S`), subject to the
  rules in `specs/towers.md`. Tier II is a single upgrade; at **tier III** the inspector
  presents the tower's **two branches** and you click the one to take (the tier-III
  identity choice) — `specs/towers.md`. Clicking empty board or pressing `Esc`
  deselects.

Selecting a tool or tower and reading the shop and inspector is done from the build panel
(`specs/board.md`); the board itself is where you place, select, and see range.

## Rounds, speed, and pause

- **Start / send round.** The **START ROUND** control in the build panel
  (`specs/board.md`) — or **`Space`** — starts the next round. Before **Round 1** the
  opening build phase is untimed and starts only when you press it; between rounds it
  also **sends the next round early** while the build-phase countdown runs, paying the
  early-send bonus (`specs/flow.md`).
- **Speed.** A **speed** toggle cycles the game speed — at least **`1×`** and **`2×`** (a
  `3×` is welcome) — scaling how many ticks pass per second so the player can fast-forward
  a quiet round and slow down for a crisis. The keys **`1`**/**`2`**(/**`3`**) are used as
  tower hotkeys above, so bind speed to a dedicated key (for example **`F`** to cycle, or
  **`+`**/**`−`**) and/or the HUD toggle; the current speed is shown (`specs/board.md`).
- **Pause / menu.** **`Esc`** with nothing held or selected opens the **Paused** overlay
  menu — **Resume**, **Restart**, **Quit to menu** (`specs/flow.md`) — and freezes the
  board behind it; in build mode or with a tower selected, `Esc` first cancels that. A
  dedicated **pause** control in the status bar also pauses and resumes in place.
- **Mute.** **`M`** (or the status-bar control) toggles audio mute (`specs/flow.md`).
- **Menus.** In the title, how-to-play, pause, victory, and containment-failed screens,
  the pointer and/or `Up`/`Down` (or `W`/`S`) move the selection and `Enter`/`Space`
  confirms (`specs/flow.md`). Every menu must be fully operable with the **mouse
  alone**, with these keyboard accelerators as an alternative.
