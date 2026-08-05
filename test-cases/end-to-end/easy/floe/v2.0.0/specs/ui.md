# UI: menus, game states, the HUD, and audio

This file defines the game's screens — the menus and the state machine that moves
between them — the heads-up display shown during a crossing, and the game's audio.
The values the HUD shows (the score, lives, level, and the crossing timer) are
defined in `specs/gameplay.md`; the strait and the HUD bar's place on the stage are
in `specs/playfield.md`; and the controls that drive each screen are in
`specs/controls.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `FLOE`, the tagline `DON'T LOOK BACK`, and a
   vertical menu: `CROSS` to begin, then `HOW TO PLAY`. The selected item is
   highlighted. A dim slice of the strait (ice, water, a floe, the bear) may show
   behind the menu for atmosphere.
2. How to play. Describes the goal (cross the strait and fill all the bays), the
   controls, that a bear hunts you across the whole strait and only your speed keeps
   you ahead, the sliding ice hazards, riding the drifting floes (and not drifting
   off the edge), and the timer. Returns to the menu.
3. In game. The live game: the strait and its bands, the hazards sliding and the
   floes drifting, the critter hopping, the bear pursuing, and the HUD.
4. Paused. Reachable in game. Offers Resume, Restart, and Quit to menu. The strait
   is visible but frozen behind the pause menu.
5. Victory. Shown when level 8 is cleared. Displays the final score, levels cleared
   (all 8), and lives remaining, with `PLAY AGAIN` and `MENU`.
6. Game over. Shown when lives reach 0. Displays the final score and the level
   reached, with `PLAY AGAIN` and `MENU`.

The three canonical screens — the title screen, the in-game view, and the
game-over screen — must be implemented as described, in the palette and type
`specs/overview.md` defines.

## The HUD

The HUD bar (`y` in `[0, 80]`, the full-width top bar defined in
`specs/playfield.md`) carries the status readouts across the full width (exact
styling is yours, matching `specs/overview.md` and the reference image):

- SCORE: the running score (`specs/gameplay.md`), the most prominent readout.
- LIVES: the crosser lives remaining, shown as a small row of critter icons or a
  count. This is the total the run has left, counting the critter currently
  crossing — not the spares behind it — so a new run reads three
  (`specs/gameplay.md`), and it drops to two the first time a life is lost.
- LEVEL: the current level as `LEVEL n / 8` (`specs/gameplay.md`).
- TIME: the per-crossing timer, as a draining bar or countdown
  (`specs/gameplay.md`).
- A small row of bay markers showing which of the 5 bays are filled is encouraged
  (in the HUD or drawn at the bays themselves).

The HUD bar is always fully visible above the strait at every window size
(`specs/overview.md`).

## Audio

Audio is required: synthesize it with the Web Audio API (no audio files), with
distinct short cues for a hop, splashing into the water, being crushed by a hazard,
the bear catching you, filling a bay, clearing a level, and the Victory and
Game-over stings. The game stays fully playable with sound muted and never fails to
run or load if audio cannot start. Provide a mute toggle (`specs/controls.md`), and
do not start audio until the player first interacts (browsers block autoplay).
