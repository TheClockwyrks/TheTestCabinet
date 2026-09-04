# Coil — Movement

This file fixes the tick the simulation runs on, the order a tick resolves in,
how the snake turns, how it grows, and what ends a round. The board it moves over
is in `specs/board.md`, and the points an eat awards are in `specs/scoring.md`.
Every figure below carries the name this specification gives it.

## The tick

The simulation advances in whole ticks of `TICK_SECONDS` (`0.125`), which is
eight ticks per second. The snake moves exactly one cell per tick, and the rate
is the same for the whole round whatever the score is and however long the snake
has grown.

The game accumulates the delta time the runtime hands each update and runs one
tick for each whole `TICK_SECONDS` the accumulator holds, leaving the remainder
to carry into the next update. Ticks are therefore driven by elapsed time rather
than by frames, and a second of game time is eight ticks whether the runtime
delivered it in one update or in sixty. Drawing never advances the simulation.

Ticks run only on the `playing` screen. A round that has ended, a paused game,
and every menu screen leave the simulation where it stands.

A tick that ends the round is the last tick of that round. Whatever elapsed time
the update was carrying beyond it is spent rather than held back, so a round that
has ended banks nothing: the next time the simulation is asked to advance, it
advances from an empty accumulator.

## The order a tick resolves in

Each tick resolves these six steps, in this order.

| Step | What happens |
| --- | --- |
| 1 | Take the oldest buffered turn, if any, and apply it to the snake's direction. |
| 2 | Compute the new head cell as the current head cell plus the current direction. |
| 3 | Test the new head cell for a fatal collision. If it is fatal, the round ends and steps 4 to 6 do not run. |
| 4 | If the new head cell holds the pellet, prepend the new head and keep the tail. Otherwise prepend the new head and drop the tail cell. |
| 5 | If the pellet was eaten, resolve the score and the combo, then spawn the next pellet. |
| 6 | Draw `TICK_SECONDS` off the combo window, and lapse the window if it reaches zero. |

## Turning

The snake always travels in one of `up`, `down`, `left`, and `right`, and it
never stops. `specs/controls.md` fixes the actions a player steers with.

A steering request is buffered rather than applied where it is made, and step 1
of the next tick applies it. The buffer holds at most `TURN_QUEUE_MAX` (`2`)
requests, and a request arriving at a full buffer is discarded.

Step 1 takes the oldest buffered request and applies it only when it is
perpendicular to the direction the snake is travelling in on this tick. While
travelling horizontally only `up` and `down` are perpendicular; while travelling
vertically only `left` and `right` are. A request that repeats the current
direction and a request that reverses it are both discarded at step 1, and the
snake keeps its direction. The snake therefore never reverses into its own neck,
and at most one turn takes effect per tick.

A pair of requests made inside one tick resolves across two ticks. Travelling
`right`, a player who requests `down` and then `left` gets the `down` on the next
tick, and the `left` on the tick after that, where it is now a valid
perpendicular turn.

## Growth

Eating a pellet lengthens the snake by exactly one cell, because step 4 keeps the
tail on that tick. On every tick that eats nothing the length is unchanged: one
cell joins at the head and one leaves at the tail.

## Collision

Step 3 tests the new head cell alone, before the tail is resolved. The head
entering any of these ends the round at once, with no grace tick and no second
chance.

| Fatal cell | Fixed by |
| --- | --- |
| A wall cell | `specs/board.md` |
| An obstacle cell | `specs/mode.md` |
| A cell holding a body segment, subject to the tail rule below | This file |

### The tail rule

Whether the tail's cell is fatal depends on whether the tail vacates it on this
tick.

| The tick | The current tail cell |
| --- | --- |
| Eats nothing, so the tail moves | Free. The head may enter it, and a snake may safely chase its own tail. |
| Eats the pellet, so the tail stays | Solid. The head entering it ends the round. |

Every other body cell is solid on every tick.

## Ending a round

A round ends in one of two ways, and each has its own screen in `specs/ui.md`.

| Ending | Cause |
| --- | --- |
| Dead | The head entered a fatal cell at step 3. |
| Board cleared | Step 5 found no valid cell for the next pellet, as `specs/board.md` defines the valid set. |
