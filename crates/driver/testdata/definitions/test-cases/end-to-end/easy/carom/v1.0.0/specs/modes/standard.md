# Carom — Standard modes (Solo and Versus)

This file defines the standard game modes and the AI opponent. It builds on the
geometry in `specs/playfield.md`, the physics in `specs/physics.md`, and the
match flow in `specs/flow.md`.

## Menu entries

This mode spec adds the following entries to the main menu (see Game states in
`specs/flow.md`), in this order:

- `SOLO`
- `VERSUS`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a mode, and is always
shown last in the menu.)

## Modes

- **Solo** — player one (left, controlled by the human) versus the AI (right).
  Normal speed rules apply: each paddle hit multiplies ball speed by **1.04**,
  clamped at a **980 px/s** cap (see `specs/physics.md`).
- **Versus** — two local players share the keyboard (player one on the left,
  player two on the right). Normal speed rules apply, exactly as in Solo.

Both modes use the standard scoring and match flow from `specs/flow.md` (first
to 11, win by 2), the single-ball serve from `specs/playfield.md`, and the spin
mechanic from `specs/physics.md`.

## AI opponent

The AI controls the right paddle in **Solo** (and in any other single-player
mode that drives the right paddle with the AI). It should be a competent but
**beatable** opponent, not a perfect wall.

- The AI may only move its paddle vertically, at a maximum of **560 px/s** —
  deliberately slower than the human's 720 px/s, so a well-placed or well-curved
  shot can beat it.
- When the ball is moving **toward** the AI, it tracks the ball's `y`, moving
  toward it but reacting with a short delay (about **0.12 s**) and stopping when
  the paddle center is within a small **10 px** deadzone of the target. It need
  not perfectly account for spin curvature — failing to read a curving shot is a
  fair way for the player to score.
- When the ball is moving **away**, the AI eases back toward the vertical center
  (`y = 360`).

These values are guidance for the right feel; tune as needed, but keep the AI
clearly beatable by a skilled player and clearly capable of punishing weak play.
