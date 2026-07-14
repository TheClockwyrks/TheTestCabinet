# Carom — Balls and serving

**One ball** is in play — the ball from `specs/playfield.md` (radius 11, serve
speed 520, `1.04` speed multiplier per paddle hit up to the 980 cap, and the spin
mechanic from `specs/physics.md`).

## Serving

At the start of the match and after each point, the ball spawns at the field
center `(640, 360)` and holds there for a **1.0 s** countdown (the Countdown
state in `specs/flow.md`, rendered over the field), then serves at the **520 px/s**
serve speed:

- The serve travels toward the **receiver** — the player who was just scored on.
  The very first serve of a match picks a side in a fixed, non-random way (for
  example, always toward player one), so the match opens consistently.
- The serve direction is within **+/-30deg** of horizontal, with a small vertical
  component so the volley is never perfectly flat.

## After a point

When a point is scored (a ball crosses a goal edge, per `specs/flow.md`), the
rally ends: the field holds through the countdown at the center, then the single
ball is re-served as above toward the player who was just scored on.
