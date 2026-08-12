# Coil — UI: game states, controls, audio, and the HUD

This file defines the game's state machine, controls, audio, and the HUD. It
refers to the geometry in `specs/board.md`, the simulation in `specs/movement.md`,
the scoring in `specs/combo.md`, and the playable mode in `specs/gameplay.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. Title / main menu. Shows the title `COIL`, the tagline `GRID SERPENT`, the
   current `BEST` score, and a vertical menu. `HOW TO PLAY` is a menu item, always
   shown last; the play entry above it is the one the mode spec adds (see
   `specs/gameplay.md`). The selected item is highlighted. The board furniture (walls,
   a coiled snake, a pellet) may show dimmed behind the menu.
2. How to play. A simple screen describing the controls and the combo mechanic.
   Returns to the menu.
3. Playing. The live game: the board, walls, the snake, the pellet, and the HUD.
   The snake advances every tick and the player steers it.
4. Paused. Reachable from play with `Esc` or `P`. Offers Resume, Restart, and
   Quit to menu. The board is visible but frozen behind the pause menu; the tick
   does not advance while paused.
5. Game over. Shown when the snake dies. Displays `GAME OVER`, the final score,
   and the `BEST` score, with Play Again and Menu. The final frame may show dimmed
   behind the panel.
6. Board cleared. The win state, shown if the snake fills the board so no new
   pellet can spawn (see `specs/board.md`). It is the game-over screen with a
   `BOARD CLEARED` heading instead of `GAME OVER`; it offers the same choices.

The game starts on the title screen and does not begin a round until the player
selects the mode.

## Controls

Keyboard only.

- Menus / pause / game-over: `Up`/`Down` (or `W`/`S`) move the selection, `Enter`
  or `Space` confirms, `Esc` goes back.
- Steering (in play): `Arrow` keys or `WASD` turn the snake (up, down, left,
  right), following the turning rules in `specs/movement.md`. The two key sets are
  interchangeable and behave identically.
- In play: `Esc` or `P` pauses.
- `M` toggles mute, from any state.

## Audio

Audio is required and is produced with the audio tools on your `PATH`, then played
back through the Web Audio API. See `specs/assets.md` for the production contract.
Produce and play, at least:

- a short eat cue when a pellet is eaten,
- a brighter combo-up cue when the combo multiplier increases,
- a distinct death sound when the snake dies, and
- a low-key background music bed that loops under the game.

Provide a mute toggle whose state is visible on the board (see the HUD below), and
do not start audio until the player interacts (browsers
block autoplay). The game still loads if audio is unavailable: guard playback so a
decode or autoplay failure never breaks the game. A finished build ships the
produced sound and music, not silence and not a hand-oscillated Web Audio
stand-in.

## HUD

The HUD occupies the band above the board (`y` in `[0, 120)`; see `specs/board.md`).
It reads, in monospace:

- Score at the left: the label `SCORE` above the current score in large digits,
  its left edge near `x = 200`.
- Best at the right: the label `BEST` above the high score in large digits, its
  right edge near `x = 1080`.
- Combo centered (near `x = 640`): the current multiplier as `x2` through `x5`,
  with a thin window bar beneath it that drains from full to empty over the 3.5 s
  combo window, in the combo accent color (see `specs/combo.md`). The combo readout
  and bar are shown only while `M` is at least `2`; at `M = 1` the combo area is
  empty.
- A small, dim label showing the current mode's name (for example `CLASSIC`) sits
  in the HUD.
- A mute indicator in the HUD, small and dim, at the right of the band. It shows
  the current sound state unambiguously and at a glance — either a marker present
  only while muted (`MUTED`, or a crossed-out speaker glyph), or a readout that
  names both states (`SOUND [M]` / `MUTED [M]`). Whichever form, the muted and
  unmuted HUDs must be tellable apart from the board alone, and it updates the
  moment `M` is pressed (`Controls`, above). Muting changes nothing else on
  screen.

## Out of scope

- Network or online play, leaderboards, or any server interaction.
- Touch or gamepad input; the game is keyboard only.
- Speed ramps or difficulty curves: the tick rate is constant within a round (see
  `specs/movement.md`).
- Persisting anything other than the high score between sessions.
