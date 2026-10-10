# Carom — Menus, screens, and navigation

This file defines the game's screens, the menus, how a player moves between them,
the scoring and match flow that drives those transitions, and audio. The
moment-to-moment play once a match is running — the paddle controls, the HUD, and
(in Solo) the AI opponent — is defined per way to play in
`specs/modes/single-player.md` and `specs/modes/versus.md`. The field geometry is
in `specs/playfield.md`, and the ball physics and spin mechanic in
`specs/balls.md`.

## Scoring and match flow

- A point is scored when a ball fully passes a goal edge (`x < 0` or `x > 1280`).
  The point goes to the player on the opposite side and increments their score.
- How a ball is served, at match start and after a point, is defined in
  `specs/balls.md`.
- First to 11 points wins, and the winner must lead by at least 2. If the score
  reaches 10-10, play continues until one player is two points ahead.

## Screens and navigation

The game is a small state machine. Each state has a clear screen, and the player
moves between them as below.

1. Title / main menu. Shows the title `CAROM`, the tagline `NEON PADDLE DUEL`,
   and a vertical menu listing `SOLO`, `VERSUS`, and then `HOW TO PLAY`. The
   selected item is highlighted. The field furniture (paddles, ball, obstacles,
   net) may show dimmed behind the menu. `SOLO` starts a single-player match
   (`specs/modes/single-player.md`); `VERSUS` starts a two-player match
   (`specs/modes/versus.md`); `HOW TO PLAY` opens the how-to-play screen.
2. How to play. A simple screen describing the controls and the spin and obstacle
   mechanics. Returns to the menu.
3. In match. The live game: paddles, ball, obstacles, net, the two scores near
   the top, and a small mode label. What the player does here, and the HUD, are
   defined per way to play in `specs/modes/single-player.md` and
   `specs/modes/versus.md`.
4. Countdown. The brief pre-serve hold before a ball is launched, rendered over
   the in-match field. When it applies is defined in `specs/balls.md`.
5. Paused. Reachable from the match. Offers Resume, Restart, and Quit to menu.
   The field is visible but frozen behind the pause menu.
6. Match over. Shown when a player wins. Displays the winner and the final score,
   with PLAY AGAIN and MENU.

## Menu navigation

Keyboard only. On the menus, the pause menu, and the match-over screen:
`Up`/`Down` (or `W`/`S`) move the selection, `Enter` or `Space` confirms, and
`Esc` goes back. The controls for playing a match — moving the paddles, pausing,
and muting — are defined per way to play in `specs/modes/single-player.md` and
`specs/modes/versus.md`.

## Audio

Audio is synthesized with the Web Audio API (no audio files): distinct short
blips for a paddle hit, a wall or obstacle bounce, and a scored point. The game
stays fully playable with sound muted and never fails to run or load if audio
cannot start. Provide a mute toggle — the `M` key, which mutes on any screen —
and do not start audio until the player interacts, since browsers block autoplay.

## Out of scope

- Network or online multiplayer.
- Touch or gamepad input. This version is keyboard only.
- Destructible obstacles. The obstacles are never destroyed, removed, or broken.
- Persistence of scores or settings between sessions.
