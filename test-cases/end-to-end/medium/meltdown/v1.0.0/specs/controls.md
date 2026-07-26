# Controls

## Overview

This file defines the controls: how the player places, selects, upgrades, and sells
towers, drives the waves, the game speed, and pause, how the same actions are reached
by touch, and how the build-panel HUD works. It builds on the floor and build panel in
`specs/playfield.md`, the towers in `specs/towers.md`, the heat system in
`specs/heat.md`, the economy in `specs/economy.md`, the run in `specs/gameplay.md`, and
the HUD layout in `specs/ui.md`.

Meltdown is pointer-driven — mouse or touch — with keyboard shortcuts as accelerators.
Every interaction and navigation is achievable with the pointer alone; the keyboard
shortcuts are a required alternative, not a requirement to play. Where this file says
"click", a touch tap does the same thing (`Touch controls`, below).

## Building a tower

1. Arm placement: click a tower in the shop (`specs/ui.md`), or press its hotkey
   (below). The cursor enters placement mode for that type.
2. Preview: as the cursor moves over the floor in placement mode, the tower's
   `size x size` footprint (`specs/towers.md`) centers on the cursor, kept fully on
   the grid. The preview shows the tower's range ring from the footprint center, its
   radiator faces at the currently-held rotation (`specs/heat.md`), and a
   valid/invalid footprint highlight (`#46d07a` valid, `#ff4d4d` invalid). A footprint
   is invalid if any tile in it is outside the floor, already occupied, under a surge
   unit, unaffordable, or would seal the floor (`specs/playfield.md`). Building right up
   against a vent or exhaust, even partly over its opening tiles, is valid, as long as
   it does not fully seal that opening or the floor.
3. Rotate: while a tower is held (in placement mode), the rotate control (below) turns
   the held preview 90 degrees, turning its radiator faces so the player can aim them
   at the open lane before committing (`specs/heat.md`). A tower's orientation is
   chosen here and fixed once it is placed; a placed tower cannot be rotated, so aim
   its faces before you drop it. Movers have no faces and do not rotate.
4. Place: left-click a valid footprint while in placement mode to build there,
   deducting the tower cost from the current money. Placement stays armed after each
   build: the tower remains held on the cursor (at the held rotation) so you can
   immediately drop another copy of the same type. It disarms on its own only when you
   can no longer afford one; otherwise it stays armed until you cancel it (Step 5).
5. Cancel: right-click or press `Esc` to leave placement mode without building.

You may build at any time, during the build phase between waves and during a live
wave (`specs/gameplay.md`), subject to affordability and the mazing rules.

## Selecting, upgrading, and selling

- Select: left-click a placed tower (when not in placement mode) to select it. Its
  range ring shows on the floor and the inspector opens in the build panel
  (`specs/ui.md`) with its stats, targeting, live heat read, its kill and damage
  counts, and actions.
- Preview from the shop: mousing over a shop tower shows that type's info (its stats,
  targeting, and a description) in the inspector area without arming or selecting
  anything, so the player can compare towers before buying (`The HUD`, below).
- Upgrade: click the Upgrade action in the inspector (or press the upgrade hotkey) to
  raise the selected tower a level if you can currently afford it (`specs/towers.md`).
- Sell: click the Sell action (or press the sell hotkey) in the inspector to sell the
  selected tower for its refund; all tiles in its footprint reopen and the surge
  re-paths based on the new tile availability (`specs/towers.md`, `specs/playfield.md`).
- Deselect: click empty floor or press `Esc` to deselect a selected tower.

## Running waves

- Send next wave: click the Send Next Wave button in the wave controls (or press
  `Space`) to release the next wave early during a build phase, claiming the
  early-send bonus (`specs/economy.md`). When a build phase's timer runs out, the next
  wave starts on its own. Before Wave 1 the opening build phase is untimed: the same
  control reads Start and begins Wave 1 only when pressed; nothing auto-starts and
  there is no early-send bonus (`specs/gameplay.md`).
- Game speed: a 1x and 2x toggle in the wave controls (or `F`) sets the simulation
  speed. It applies to the whole simulation and persists until changed
  (`specs/gameplay.md`).
- Pause: clicking the Pause button in the wave controls, or pressing `Esc` or `P`,
  pauses the game and opens the pause menu (`specs/ui.md`). The floor is shown frozen
  behind it.

## The HUD

The build panel draws the whole HUD (`specs/ui.md` fixes what it draws and where);
this section fixes how each part of it behaves.

- The shop. Selecting a shop entry arms placement for that type (above). Hovering a
  shop tower (mousing over its button) shows that type's info panel in the inspector
  area, in place of the next-wave preview: the same fields the selected-tower inspector
  shows for a placed tower — type, size, range, damage or effect, fire rate, targeting,
  mass, and radiator faces — at the tower's base (level I) values, minus the
  runtime-only reads that only a placed instance has (its live heat bar and its instance
  kill and damage tallies), plus a short description of what the tower does and how it
  works. The panel returns to its prior contents when the cursor leaves the shop.
- The selected-tower inspector. When a placed tower is selected, this area shows its
  type and level, its current stats (size, range, damage or effect, fire rate,
  targeting, mass, and radiator faces), its targeting read, its live heat read (the
  same heat value drawn on the tower footprint, shown here as a labeled bar with the
  redline marker, `specs/heat.md`), its instance kill count and total damage dealt, and
  Upgrade (with its cost) and Sell (with its refund) actions. A placed tower cannot be
  rotated, so the inspector has no rotate action; orientation is chosen on the held
  preview before placing.
  - Targeting read. Both the shop-hover info panel and the selected-tower inspector
    show what the tower fires on. Every emitter except the Flak targets ground and air;
    the Flak is air-only (`specs/towers.md`). The Forge and Sink never fire, so their
    targeting reads as none.
  - Kill and damage counts. The selected-tower inspector shows the selected tower's
    lifetime kills (surge units it has destroyed, the unit whose killing blow it landed)
    and total damage dealt. These are per-instance runtime tallies, so they appear only
    on a placed, selected tower, not on the shop-hover info panel. The Forge and Sink
    deal no damage, so both read 0.
  - Live damage and heat multiplier. For an emitter, the inspector's damage read shows
    the tower's current per-shot damage together with its heat damage multiplier, the
    factor the tower's heat is applying to its base damage right now, shown beside the
    damage value (for example `42 (x3.5 heat)`). The multiplier climbs as the tower
    heats, from about 0.35x stone-cold up to 3.5x at the tower's redline, and then holds
    flat at that maximum from the redline up to the 100 trip (`specs/heat.md`): pushing a
    tower past its redline adds trip risk, not more damage. This readout, not just the
    emitter's glow, is where the player watches heat turn into power and sees the damage
    plateau directly. The heat-averse Rime shows its live slow percentage in place of a
    damage read, since it has no damage plateau (`specs/towers.md`).
- Wave controls. The Send next wave action (with its early-send bonus), the game-speed
  toggle (1x / 2x), and Pause behave as `Running waves` above describes.

## Touch controls

The game is fully playable on a touchscreen; every action above is reachable by touch
alone, since the whole 1280 x 720 stage is always on screen (`specs/overview.md`) and
there is nothing to pan or scroll to.

- Tap a shop entry to arm its type (the tap both arms placement and shows that type's
  info in the inspector, standing in for mouse hover). Tap a placed tower to select it
  and open its inspector; tap empty floor to deselect or to cancel a held placement.
- While a tower is held, drag a finger over the floor to move the preview footprint
  (it tracks the touch point, kept on the grid, with the same valid/invalid highlight),
  and lift or tap on a valid footprint to place it. Placement stays armed after each
  drop, as with the mouse.
- Because touch has no right-click or hover, the on-floor and panel controls that a
  mouse reaches with those are given on-screen buttons: a Rotate button rotates the
  held preview, and a Cancel control leaves placement mode. The inspector's Upgrade and
  Sell, the wave controls (Send next wave / Start, the 1x/2x speed toggle, Pause), and
  the mute toggle are all on-screen buttons a tap operates. Every menu is navigated by
  tapping its entries.
- Make touch targets comfortably large enough to tap on the fitted stage; the buttons
  are part of the HUD in the build panel (`specs/ui.md`), never floating over the play
  area beyond the transient placement preview.

## Keyboard shortcuts (accelerators)

The pointer path above is the primary input; the keyboard shortcuts below are required
alongside it.

- Arm a shop tower: number keys `1` to `8` arm the eight tower types in shop order
  (top to bottom, left to right).
- Rotate faces: a key (for example `R`) turns the held emitter preview 90 degrees
  (placement mode only; a placed tower cannot be rotated); state it in the in-game
  how-to and the produced `README.md`.
- Cancel placement / deselect / back: `Esc`.
- Send next wave: `Space`.
- Game speed toggle: `F`.
- Pause: `P` (or `Esc` from live play).
- Upgrade / Sell selected: a key each (for example `U` to upgrade, `S` to sell); state
  them in the in-game how-to and the produced `README.md`.
- Mute audio: a key (for example `M`) toggles sound (`specs/ui.md`).
- Menus / pause / game-over navigation: the pointer selects and confirms; `Enter`
  confirms a focused item and `Esc` goes back.

A held key does not auto-repeat an action that should fire once per press (arming,
sending a wave, toggling speed, pausing, muting, upgrading, selling). Whatever exact
keys you choose, list them in the in-game How to play screen (`specs/ui.md`) and in the
produced `README.md`.
