# Valence — Controls

This file defines how the player interacts with the board: the simulation step,
freely placing and inspecting towers, starting rounds, and the speed and pause
controls. It builds on the board and its free tower placement in
`specs/board.md`, the towers in `specs/towers.md`, and the campaign in
`specs/gameplay.md`. Keyboard and mouse only; no touch or gamepad for this
version.

## Simulation

Run the simulation on a fixed timestep of 60 Hz — a tick of exactly 1/60 of a
second — decoupled from rendering, so matter movement, tower fire,
decomposition, and the economy are reproducible and do not depend on the render
frame rate. The rate is fixed rather than a suggestion, because
`specs/instrumentation.md` advances the simulation in whole ticks of it and a
tick is only a unit if its length is fixed. Render with smooth interpolation
between ticks. The speed controls (below) scale how many ticks pass per real second;
pause halts ticks entirely. Pausing comes in two forms that both freeze ticks
but differ in what else they do: an in-place pause that leaves the board fully
interactive, and the pause menu, described under Rounds, speed, and pause below.
`specs/instrumentation.md` requires the same fixed-timestep, render-free,
seedable core and defines how it is driven and inspected.

## Building and inspecting towers

The player builds by freely placing towers on the board (`specs/board.md`):

- Build. Choose a tower in the shop (click its entry, or press its hotkey,
  `1`–`7` for the seven towers in shop order) to enter build mode for that type;
  the cursor then shows the held tower following the pointer and its range ring,
  cued for whether the spot under the pointer is legal. Click a legal spot to
  build it there, spending its cost (`specs/towers.md`, `specs/gameplay.md`).
  Building is refused (clearly) on a path, out of bounds, where it would overlap
  another tower, or when you cannot afford it. Build mode stays active so you
  can place several of a type in a row; `Esc` or right-click leaves build mode.
- Select. Click a built tower to select it. The selected tower shows its range
  ring, and the build-panel inspector shows its type, tier and branch, live
  stats, and its upgrade and sell controls (`specs/board.md`,
  `specs/towers.md`).
- Upgrade / sell. With a tower selected, upgrade it (the inspector's control, or
  press `U`) or sell it (the inspector's control, or press `S`), subject to the
  rules in `specs/towers.md`. Tier II is a single upgrade; at tier III the
  inspector presents the tower's two branches and you click the one to take (the
  tier-III identity choice), `specs/towers.md`. Clicking empty board or pressing
  `Esc` deselects.
- Targeting priority. With a damage tower selected, its inspector shows a
  targeting control that cycles the tower's targeting priority: `first` → `last`
  → `nearest` → `farthest` → `strongest` → `weakest` and back, each click (or
  press `T`). The current priority is shown on the control, applies to that
  tower only, defaults to `first`, and takes effect immediately
  (`specs/towers.md`). The two support auras have no single target, so the
  control does not appear for them.
- Inert priority. Beside the targeting control, a damage tower's inspector shows
  an inert-priority toggle (the analogue of a camo-priority option). Clicking it
  (or pressing `I`) flips the tower between firing on inert matter it can see
  first and its normal priority; the toggle reads its on/off state clearly,
  applies to that tower only, and defaults to off (`specs/towers.md`). It does
  not appear for the support auras.

Selecting a tool or tower and reading the shop and inspector is done from the
build panel (`specs/board.md`); the board itself is where you place, select, and
see range.

## Rounds, speed, and pause

- Start / send round. The START ROUND control in the build panel
  (`specs/board.md`), or `Space` while the build phase is running, starts the
  next round. Before Round 1 the opening build phase is untimed and starts only
  when you press it; between rounds it also sends the next round early while the
  build-phase countdown runs, paying the early-send bonus (`specs/gameplay.md`).
  Once a round is live, `Space` instead toggles the in-place pause (below);
  there is no round to send mid-round, so the key becomes the pause/resume
  toggle.
- Speed. A speed toggle cycles the game speed, at least `1×` and `2×` (a `3×` is
  welcome), scaling how many ticks pass per second so the player can
  fast-forward a quiet round and slow down for a crisis. The keys `1`/`2`(/`3`)
  are used as tower hotkeys above, so bind speed to a dedicated key (for example
  `F` to cycle, or `+`/`−`) and/or the HUD toggle; the current speed is shown
  (`specs/board.md`).
- In-place pause. A dedicated pause control in the status bar, and, once a round
  is live, `Space`, pauses and resumes in place: it freezes ticks (matter, fire,
  decomposition, the economy, and any build-phase countdown all halt) without
  opening any menu, and the board stays fully interactive; you can keep placing,
  upgrading, selling, and inspecting towers on the still board, then resume. The
  frozen state is clearly indicated (`specs/board.md`). This is distinct from
  the pause menu below.
- Pause menu. `Esc` with nothing held or selected opens the Paused overlay menu
  (Resume, Restart, Quit to menu, `specs/ui.md`), which also freezes the
  board behind it; in build mode or with a tower selected, `Esc` first cancels
  that. Opening the menu freezes the game even if it was already paused in
  place, and Resume returns to normal running play (clearing any in-place
  pause).
- Mute. `M` (or the status-bar control) toggles audio mute
  (`specs/gameplay.md`).
- Menus. In the title, map-select, how-to-play, pause, victory, and
  containment-failed screens, the pointer moves the selection and a click
  confirms, and `Up`/`Down` (or `W`/`S`) move the selection and `Enter`/`Space`
  confirms (`specs/ui.md`); `Esc` backs out of map-select and how-to-play to the
  main menu. Every menu must be fully operable with the mouse alone AND with the
  keyboard alone: the two are alternatives offered to the player, not a choice
  the build makes. The keyboard is also the half of the pair
  `specs/instrumentation.md` can inject, so a menu that answers only the pointer
  leaves its screen unreachable from code.
