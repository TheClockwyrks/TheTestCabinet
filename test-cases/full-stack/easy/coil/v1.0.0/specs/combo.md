# Coil — Scoring, the combo mechanic, and the high score

This file defines how the game scores, its signature combo multiplier, and the
persistent high score. It builds on the simulation in `specs/movement.md` and the
board in `specs/board.md`.

## Scoring

- Each pellet eaten awards `10 * M` points, where `M` is the current combo
  multiplier (`1` to `5`). The score never decreases.
- The score updates immediately on the tick the pellet is eaten. There is no
  animated count-up that lags the value.

## The combo mechanic

Score is shaped by a combo multiplier that rewards eating pellets in quick
succession. This is Coil's defining mechanic.

- The multiplier `M` is an integer, starts each round at `1`, and is capped at
  `5`.
- A combo window of 3.5 seconds of simulation time governs the multiplier. Eating
  a pellet reopens a fresh 3.5 s window.
- When a pellet is eaten:
  - if the combo window was open (it had not yet expired since the last pellet),
    `M` increases by one, to a maximum of `5`;
  - if the window was closed (this is the first pellet of the round, or the window
    had lapsed), `M` resets to `1`.
  - The pellet then awards `10 * M` points using the updated `M`, and the window
    reopens for another 3.5 s.
- If the combo window lapses without a pellet being eaten (step 6 of the tick
  expires it, see `specs/movement.md`), `M` resets to `1`.

The window is measured in simulation time and decremented each tick by the tick's
elapsed time, so it is independent of the tick rate. At the base 8-ticks-per-second
rate, 3.5 s is 28 ticks, and the snake covers exactly one cell per tick, so the
window is a travel budget of 28 cells. That budget is sized against the board so a
lost combo is the player's fault rather than the spawn's: on the interior the mean
distance from one pellet to the next is well under the budget, so a direct route
holds the combo, and the combo breaks from the detours forced by the snake's own
lengthening body and by wandering, not from a spawn too far to reach in time.

## HUD

The combo is shown in the HUD, centered near `x = 640`: the current multiplier as
`x2` through `x5`, with a thin window bar beneath it that drains from full to empty
over the 3.5 s combo window, in the combo accent color. The combo readout and bar
are shown only while `M` is at least `2`; at `M = 1` the combo area is empty. The
full HUD layout is in `specs/interface.md`.

## High score

A high score, labeled `BEST`, is the highest score achieved across sessions. Store
it locally in the browser with `localStorage`, with no backend and no account. It
updates live during play the instant the current score passes it, and is shown on
the title screen and during play. The high score is the only thing that persists
between sessions; nothing else is saved.
