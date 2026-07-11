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
2. **Preview** — as the cursor moves over the floor in placement mode, the
   tower's **`size x size` footprint** (`specs/towers.md`) centers on the cursor,
   kept fully on the grid. The preview shows the tower's **range** ring from the
   footprint center, its **radiator faces** at the currently-held rotation
   (`specs/heat.md`), and a **valid/invalid** footprint highlight (`#46d07a`
   valid, `#ff4d4d` invalid). A footprint is invalid if any tile in it is outside
   the floor, already occupied, under a surge unit, unaffordable, or would seal the
   floor (`specs/playfield.md`). Building right up against a vent or exhaust — even
   partly over its opening tiles — is *valid*, as long as it does not fully seal
   that opening or the floor.
3. **Rotate** — while a tower is **held** (in placement mode), the **rotate**
   control (below) turns the held preview `90°`, turning its radiator faces so the
   player can aim them at the open lane **before committing** (`specs/heat.md`). A
   tower's orientation is chosen here and **fixed once it is placed** — a placed
   tower cannot be rotated, so aim its faces before you drop it. Movers have no
   faces and do not rotate.
4. **Place** — left-click a valid footprint while in placement mode to build
   there, deducting the tower cost from the current money. **Placement stays
   armed after each build** — the tower remains "held" on the cursor (at the held
   rotation) so you can immediately drop another copy of the same type. It disarms
   on its own only when you can no longer afford one; otherwise it stays armed
   until you cancel it (Step 5).
5. **Cancel** — right-click or press `Esc` to leave placement mode without
   building.

You may build at any time — during the build phase between waves **and** during
a live wave (`specs/flow.md`) — subject to affordability and the mazing rules.

## Selecting, Upgrading, and Selling

- **Select** — left-click a placed tower (when not in placement mode) to select
  it. Its range ring shows on the floor and the **inspector** opens in the build
  panel (`specs/playfield.md`) with its stats, **targeting**, **live heat read**,
  its **kill and damage counts**, and actions.
- **Preview from the shop** — mousing over a shop tower shows that type's info
  (its stats, targeting, and a description) in the inspector area without arming or
  selecting anything, so the player can compare towers before buying
  (`specs/playfield.md`).
- **Upgrade** — click the **Upgrade** action in the inspector (or press the
  upgrade hotkey) to raise the selected tower a level if you can currently
  afford it (`specs/towers.md`).
- **Sell** — click the **Sell** action (or press the sell hotkey) in the
  inspector to sell the selected tower for its refund; all four tiles in its
  footprint reopen and the surge re-paths based on the new tile availability
  (`specs/towers.md`, `specs/playfield.md`).
- **Deselect** — click empty floor or press `Esc` to deselect a selected tower.

## Running Waves

- **Send next wave** — click the 'Send Next Wave' button in the wave controls
  (or press `Space`) to release the next wave early during a build phase,
  claiming the **early-send bonus** (`specs/flow.md`). When a build phase's
  timer runs out, the next wave starts on its own. **Before Wave 1 the opening
  build phase is untimed:** the same control reads **'Start'** and begins Wave 1
  only when pressed — nothing auto-starts and there is no early-send bonus
  (`specs/flow.md`).
- **Game speed** — a `1x` and `2x` toggle in the wave controls (or `F`) sets
  the simulation speed. It applies to the whole simulation and persists until
  changed.
- **Pause** — clicking the 'Pause' button in the wave controls, or pressing
  `Esc` or `P` (or the pause control) pauses the game and opens the pause menu
  (`specs/flow.md`). The floor is shown frozen behind it.

## Keyboard shortcuts (accelerators)

The mouse path above is the primary pointing device; the keyboard shortcuts
below are **required** alongside it.

- **Arm a shop tower:** number keys `1`–`8` arm the eight tower types in shop
  order (top to bottom, left to right).
- **Rotate faces:** a key (for example `R`) turns the **held** emitter preview
  `90°` (placement mode only — a placed tower cannot be rotated); state it in the
  in-game how-to and the produced `README.md`.
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
