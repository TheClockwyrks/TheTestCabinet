# Carom — Single player (Solo)

Solo is one of the two ways to play Carom, reached from `SOLO` on the main menu
(`specs/ui.md`). It pits player one — the left paddle, controlled by the human —
against the AI on the right. Everything else is the shared game: the field and
obstacles (`specs/playfield.md`), the balls, serving, and physics
(`specs/balls.md`), and the scoring and match flow (`specs/ui.md`). Solo and
Versus (`specs/modes/versus.md`) are otherwise the same game and differ only in
who controls the right paddle — the AI here, a second human there.

## Controls

Keyboard only.

- The human moves player one (the left paddle) with `W`/`S` or `Up`/`Down`. The
  paddle moves at the constant speed defined in `specs/playfield.md` while a
  movement key is held, and is otherwise stationary.
- `Esc` or `P` pauses at any time (the Paused screen in `specs/ui.md`).
- `M` toggles mute.

The right paddle is not player-controlled in Solo; the AI drives it (below).

## HUD

- The two scores sit near the top of the field in large monospace digits (about
  76 px tall): player one's score centered near `x = 520` and player two's near
  `x = 760`, with their tops near `y = 40`.
- A small, dim mode label (`SOLO`) sits in the top-left during a match.

## AI opponent

The AI controls the right paddle in Solo. It is a competent but beatable
opponent, not a perfect wall.

- The AI moves its paddle vertically at a maximum of 560 px/s, deliberately
  slower than the human's 720 px/s, so a well-placed or well-curved shot can beat
  it.
- When the ball is moving toward the AI, it tracks the ball's `y`, reacting with
  a short delay of about `0.12 s` and stopping when the paddle center is within a
  small 10 px deadzone of the target. It does not perfectly account for spin
  curvature, so a curving shot can get past it.
- When the ball is moving away, the AI eases back toward the vertical center
  (`y = 360`).

The AI must stay clearly beatable by a skilled player while remaining clearly
capable of punishing weak play.
