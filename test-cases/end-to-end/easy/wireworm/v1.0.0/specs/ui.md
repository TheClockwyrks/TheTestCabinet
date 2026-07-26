# UI: screens, the HUD, and audio

## Overview

This file defines the game's state machine, the main menu, the HUD, audio, and
what is out of scope. It refers to the board in `specs/board.md`, the charge
system in `specs/charge.md`, the worm in `specs/worm.md`, the foes in
`specs/foes.md`, the controls in `specs/controls.md`, and the run rules in
`specs/progression.md`.

## The game

Wireworm is one continuous run down a single board: you hold the board of
`specs/board.md` against the data-worm across all 12 levels, cutting the worm apart
before it reaches your band, pacing the charge of the field to build and then
release a chain-arc discharge at the right moment, and answering the three foes,
shooting the glitch before it eats your charged cluster, cutting the dropper's
reseed short, and detonating the corruptor's critical line before the worm dives
it, until `LEVEL 12` is cleared or your lives run out. Every system behaves exactly
as the other specs define it.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `WIREWORM`, the tagline `CUT THE CURRENT`,
   and a vertical menu with two entries, `DESCEND` (start a run) and then
   `HOW TO PLAY`. The selected item is highlighted. A dim slice of board with a few
   glowing nodes and a worm may show behind the menu for atmosphere.
2. How to play. Describes the goal (cut the worm apart before it reaches your
   band), the controls, the charge field and the chain-arc discharge, that critical
   nodes make the worm dive, that shooting the worm grows the field, and the three
   foes. Returns to the menu.
3. In game. The live game: the board and its node field, the worm winding and
   diving, your cursor firing, foes, discharges, and the HUD.
4. Paused. Reachable in game. Offers Resume, Restart, and Quit to menu. The board
   is visible but frozen behind the pause menu.
5. Victory. Shown when level 12 is cleared with lives remaining. Displays the final
   score, levels cleared (all 12), and lives remaining, with `PLAY AGAIN` and
   `MENU`.
6. Game over. Shown when lives reach 0. Displays the final score and the level
   reached, with `PLAY AGAIN` and `MENU`.

## HUD

The HUD lives in the top bar (`specs/board.md`) and carries three readouts across
the full width:

- Score, the running score (`specs/progression.md`), the most prominent readout.
- Lives, the cursor lives remaining, shown as a small row of cursor icons or a
  count.
- Level, the current level as `LEVEL n / 12`.

A compact hazard indicator, for example a small note when a corruptor or dropper
is active (`specs/foes.md`), is encouraged but not required. The HUD bar is always
fully visible above the board (`specs/overview.md`). On the board, nodes show their
charge by sprite (`specs/charge.md`), and the worm and foes carry no health bars.

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files), with
distinct short cues for firing a bolt, cutting a worm segment, a chain-arc
discharge going off, a node reaching critical, killing a foe, losing a life,
clearing a level, and the Victory and Game-over stings. The game stays fully
playable with sound muted and never fails to run or load if audio cannot start.
Provide a mute toggle, and do not start audio until the player interacts (browsers
block autoplay).

## Out of scope

- Network or online multiplayer, and any saved or persisted progress between
  sessions (including high scores).
- Touch or gamepad input (mouse and keyboard only for this version).
- A level editor, alternate boards, or difficulty menus. This is the one board and
  the one 12-level run.
- Power-ups, weapon upgrades, or an economy or shop. The cursor's one weapon is the
  upward bolt.
