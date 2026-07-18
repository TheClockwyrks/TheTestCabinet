# Carom — Match flow, states, controls, and HUD

This file defines scoring, the game's state machine, controls, audio, and the
HUD. It refers to the geometry in `specs/playfield.md`, the physics in
`specs/physics.md`, and the Solo and Versus play in `specs/modes.md`.

## Scoring and match flow

- A point is scored when a ball fully passes a goal edge (`x < 0` or `x > 1280`).
  The point goes to the player on the opposite side and increments their score.
- How a ball is served, at match start and after a point, is defined in
  `specs/balls.md`.
- First to 11 points wins, and the winner must lead by at least 2. If the score
  reaches 10-10, play continues until one player is two points ahead.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. Title / main menu. Shows the title `CAROM`, the tagline `NEON PADDLE DUEL`,
   and a vertical menu listing `SOLO`, `VERSUS`, and then `HOW TO PLAY`. The
   selected item is highlighted. The field furniture (paddles, ball, obstacles,
   net) may show dimmed behind the menu.
2. How to play. A simple screen describing the controls and the spin and obstacle
   mechanics. Returns to the menu.
3. In match. The live game: paddles, ball, obstacles, net, the two scores near
   the top, and a small mode label.
4. Countdown. The brief pre-serve hold before a ball is launched, rendered over
   the in-match field. When it applies is defined in `specs/balls.md`.
5. Paused. Reachable from the match. Offers Resume, Restart, and Quit to menu.
   The field is visible but frozen behind the pause menu.
6. Match over. Shown when a player wins. Displays the winner and the final score,
   with PLAY AGAIN and MENU.

## Controls

Keyboard only.

- Menus, pause, and match-over: `Up`/`Down` (or `W`/`S`) move the selection,
  `Enter` or `Space` confirms, and `Esc` goes back.
- Solo: the human moves player one with `W`/`S` or `Up`/`Down`.
- Versus: player one uses `W`/`S` and player two uses `Up`/`Down`.
- In match: `Esc` or `P` pauses.
- `M` toggles mute on any screen.

## Audio

Audio is synthesized with the Web Audio API (no audio files): distinct short
blips for a paddle hit, a wall or obstacle bounce, and a scored point. The game
stays fully playable with sound muted and never fails to run or load if audio
cannot start. Provide a mute toggle, and do not start audio until the player
interacts, since browsers block autoplay.

## HUD

- The two scores sit near the top of the field in large monospace digits (about
  76 px tall): player one's score centered near `x = 520` and player two's near
  `x = 760`, with their tops near `y = 40`.
- A small, dim mode label (for example `SOLO`) sits in the top-left during a
  match.

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input. This version is keyboard only.
- Destructible obstacles. The obstacles are never destroyed, removed, or broken.
- Persistence of scores or settings between sessions.
