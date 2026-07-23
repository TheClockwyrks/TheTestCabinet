# Controls

## Overview

This file defines the controls: moving the cursor in the player band, firing, and
pausing. It refers to the player band in `specs/board.md` and the shot rules in
`specs/charge.md` and `specs/worm.md`.

## Moving the cursor

The cursor is confined to the player band, the bottom 2 rows of the board
(`specs/board.md`), and moves freely in logical pixels within it, not snapped to
tiles.

The arrow keys and WASD move the cursor: left and right across the full width of
the band, and up and down within the two rows. Movement is smooth and continuous
while a key is held. The cursor is clamped to the band: it can never leave it,
never above row `18`, never past a side edge, never below the floor.

Movement speed must be responsive enough to dodge a diving worm and a
skittering glitch.

## Firing

The cursor fires bolts straight up (`specs/charge.md`, `specs/worm.md`).

- Fire key. Space fires. A held fire key auto-repeats at the fire cadence.
- Fire cadence. A bolt may be fired at most every `0.15 s`; at most 3 bolts may be
  in flight at once. These keep firing deliberate rather than a continuous beam.
- Bolt travel. A bolt spawns at the cursor's muzzle and travels straight up at
  about `900 px/s`, stopping at the first node, worm segment, or foe in its column
  (resolving the hit per `specs/charge.md` for a node, `specs/worm.md` for a
  segment, or `specs/foes.md` for a foe) or vanishing at the top of the board if it
  hits nothing. A bolt hits at most one thing.

## Pause and system controls

- Pause. P or Escape pauses the game from the in-game state, opening the pause menu
  (Resume, Restart, Quit to menu, see `specs/ui.md`). Pausing freezes the
  simulation.
- Menus. In the title and end screens, the menu is navigable by keyboard (arrow
  keys or W/S to move the selection, Enter or Space to confirm).
- Mute. Audio is required (`specs/ui.md`); provide a mute toggle, for example
  M.

Keyboard only for this version; no mouse, touch, or gamepad.
