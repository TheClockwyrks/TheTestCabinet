# Controls

## Overview

This file defines the controls: how the player places, selects, upgrades, and
sells towers, and how they drive the waves, the game speed, and pause. It builds
on the floor and build panel in `specs/playfield.md`, the towers in
`specs/towers.md`, and the flow in `specs/flow.md`.

Meltdown is **mouse-driven**, with keyboard shortcuts as accelerators. All
interactions and navigation must be achievable with the mouse alone.

## Simulation

Simulation must run on a **fixed timestep** (for example 60 Hz) decoupled from
rendering, so movement, firing, heat, and pathing are reproducible and
independent of the render frame rate. The **game-speed** control (below) changes
how many simulation steps run per real second; it must not change the *outcome*
of the simulation, only how fast it plays.

## Building a Tower

1. **Arm placement** — click a tower in the shop (`specs/playfield.md`), or
   press its hotkey (below). The cursor enters placement mode for that type.
2. **Preview** — as the cursor moves over the floor in placement mode, the tile
   under it shows a placement preview: the tower's **range** ring and a
   **valid/invalid** tile highlight (`#46d07a` valid, `#ff4d4d` invalid). A
   tile is invalid if it is an intake/exhaust, already occupied, under a surge
   unit, unaffordable, or would
   seal the floor (`specs/playfield.md`).
3. **Place** — left-click a valid tile while in placement mode to build there,
   deducting the tower cost from the current money. With a modifier or a sticky
   toggle you may keep placing the same type for repeated builds; otherwise
   placement disarms after one build.
4. **Cancel** — right-click or press `Esc` to leave placement mode without
   building.

You may build at any time — during the build phase between waves **and** during
a live wave (`specs/flow.md`) — subject to affordability and the mazing rules.

## Selecting, Upgrading, and Selling

- **Select** — left-click a placed tower (when not in placement mode) to select
  it. Its range ring shows on the floor and the **inspector** opens in the build
  panel (`specs/playfield.md`) with its stats, **live heat read**, and actions.
- **Upgrade** — click the **Upgrade** action in the inspector (or press the
  upgrade hotkey) to raise the selected tower a level if you can currently
  afford it (`specs/towers.md`).
- **Sell** — click the **Sell** action (or press the sell hotkey) in the
  inspector to sell the selected tower for its refund; its tile reopens and the
  surge re-paths based
  on the new tile availability (`specs/towers.md`, `specs/playfield.md`).
- **Deselect** — click empty floor or press `Esc` to deselect a selected tower.

## Running Waves

- **Send next wave** — click the 'Send Next Wave' button in the wave controls
  (or press `Space`) to release the next wave early during a build phase,
  claiming the **early-send bonus** (`specs/flow.md`). When a build phase's
  timer runs out, the next wave starts on its own.
- **Game speed** — a `1x` and `2x` toggle in the wave controls (or `F`) sets
  the simulation speed. It applies to the whole simulation and persists until
  changed.
- **Pause** — clicking the 'Pause' button in the wave controls, or pressing
  `Esc` or `P` (or the pause control) pauses the game and opens the pause menu
  (`specs/flow.md`). The floor is shown frozen behind it.

## Keyboard shortcuts (accelerators)

Keyboard is optional convenience; the mouse path above is the primary one.

- **Arm a shop tower:** number keys `1`–`8` arm the eight tower types in shop
  order (top to bottom, left to right).
- **Cancel placement / deselect / back:** `Esc`.
- **Send next wave:** `Space`.
- **Game speed toggle:** `F`.
- **Pause:** `P` (or `Esc` from live play).
- **Upgrade / Sell selected:** a key each (for example `U` to upgrade, `S` to
  sell); state them in the in-game how-to and the produced `README.md`.
- **Menus / pause / game-over navigation:** the mouse selects and confirms;
  `Enter` confirms a focused item and `Esc` goes back.

A held key does not auto-repeat an action that should fire once per press
(arming, sending a wave, toggling speed, pausing, upgrading, selling). Whatever
exact keys you choose, list them in the in-game **How to play** screen
(`specs/flow.md`) and in the produced `README.md`.
