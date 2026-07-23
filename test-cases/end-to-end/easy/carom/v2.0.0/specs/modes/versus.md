# Carom — Versus

Versus is one of the two ways to play Carom, reached from `VERSUS` on the main
menu (`specs/ui.md`). It is two local players sharing the keyboard, player one on
the left and player two on the right, with no AI. Everything else is the shared
game: the field and obstacles (`specs/playfield.md`), the balls, serving, and
physics (`specs/balls.md`), and the scoring and match flow (`specs/ui.md`). Versus
and Solo (`specs/modes/single-player.md`) are otherwise the same game and differ
only in who controls the right paddle — a second human here, the AI there.

## Controls

Keyboard only. Both paddles move at the constant speed defined in
`specs/playfield.md` while a movement key is held, and are otherwise stationary.

- Player one moves the left paddle with `W`/`S`.
- Player two moves the right paddle with `Up`/`Down`.
- Each movement key moves only its own player's paddle.
- `Esc` or `P` pauses at any time (the Paused screen in `specs/ui.md`).
- `M` toggles mute.

## HUD

- The two scores sit near the top of the field in large monospace digits (about
  76 px tall): player one's score centered near `x = 520` and player two's near
  `x = 760`, with their tops near `y = 40`.
- A small, dim mode label (`VERSUS`) sits in the top-left during a match.
