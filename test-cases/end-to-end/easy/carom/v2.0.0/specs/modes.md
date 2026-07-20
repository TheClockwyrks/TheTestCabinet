# Carom — Solo and Versus, and the AI opponent

This file defines the two ways to play, Solo and Versus, and the AI opponent. It
builds on the geometry in `specs/playfield.md`, the physics in `specs/physics.md`,
and the match flow in `specs/flow.md`.

## Menu entries

The main menu (see Game states in `specs/flow.md`) lists two ways to play, in
this order: `SOLO`, then `VERSUS`. `HOW TO PLAY` is a state defined in
`specs/flow.md` rather than a way to play, and is always shown last in the menu.

## The two ways to play

- Solo pits player one (left, controlled by the human) against the AI (right).
- Versus is two local players sharing the keyboard, player one on the left and
  player two on the right, with no AI.

Solo and Versus are otherwise the same game: the same field, obstacles, balls,
serving, scoring, match flow, and spin mechanic. They differ only in who controls
the right paddle, the AI in Solo and a second human in Versus.

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

These values set the feel; tune them as needed while keeping the AI clearly
beatable by a skilled player and clearly capable of punishing weak play.
