# Coil — Scoring

This file fixes what an eaten pellet is worth, the combo multiplier that shapes
it, and the best score. The tick the combo is measured against is in
`specs/movement.md`, and the readouts that show these figures are in
`specs/ui.md`. Every figure below carries the name this specification gives it.

## The score

A round starts at a score of `0`. Eating a pellet awards `PELLET_POINTS` (`10`)
multiplied by the combo multiplier in force after the eat resolves. The score
rises on the tick the pellet is eaten and never falls, and its readout shows the
new value on that same tick rather than counting up toward it.

## The combo multiplier

The combo multiplier `M` is a whole number. It starts each round at `1` and is
capped at `COMBO_MAX` (`5`).

A combo window of `COMBO_WINDOW` (`3.5`) seconds of simulation time governs it.
The window is open while time remains on it and closed once that time is spent.
Step 6 of each tick draws `TICK_SECONDS` off the window, and the tick that opens
a window is the first to draw on it. A full window therefore spans 28 ticks: the
27 ticks after the eat that opened it still meet it open, and the 28th finds it
spent.

An eaten pellet resolves the multiplier before it awards the points.

| The window at the eat | `M` becomes |
| --- | --- |
| Open | One higher, up to `COMBO_MAX` |
| Closed | `1` |

The eat then awards `PELLET_POINTS * M` at that new `M`, and reopens the window
at a full `COMBO_WINDOW`. A window that runs out with no pellet eaten lapses, and
`M` returns to `1` on the tick it lapses. The first pellet of a round meets a
closed window, so it scores at `M` of `1`.

## The best score

`BEST` is the highest score reached in the current session. It rises the instant
the live score passes it, during play rather than at the end of a round, and it
carries from one round to the next so a player who plays again keeps it. A fresh
session starts it at `0`.

## Out of scope

- Persistence of the score, the best score, or any setting between sessions. Each
  session starts fresh.
- Any speed ramp or difficulty curve tied to the score or the snake's length. The
  tick rate is fixed for the whole round.
