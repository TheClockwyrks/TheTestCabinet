# Cascade — Winning and the victory cascade

This file defines the win and the victory cascade that follows it: the cadence
cards launch at, the motion of a card in flight, the trail it paints, and how the
cascade ends. The anchors cards launch from are in `specs/table.md`, and the
screen the cascade runs on is in `specs/screens.md`.

## The win

The game is won the instant all `DECK_SIZE` (`52`) cards are on the foundations,
each foundation complete from its Ace to its King. The win is reached by whatever
move put the last card home, whether a released drop or a double click, and the
game moves to the `won` screen on that move. Play stops there: no further card is
moved by the player and the table below is empty.

A game with no legal move left is simply unwinnable. There is no loss condition
and no timer, and a player leaves such a game through the controls
`specs/screens.md` states.

## The cascade

The victory cascade begins with the win. Every card on the foundations launches
in turn, arcs under gravity, bounces along the floor, paints itself onto the
table as it goes, and drifts off a side edge.

### The launch clock

The cascade keeps a launch clock, in seconds, which holds `LAUNCH_INTERVAL`
(`0.18`) when the cascade begins, so the first card launches on the cascade's
first frame.

Each frame the clock adds the frame's delta. While it holds at least
`LAUNCH_INTERVAL` and cards remain to be launched, `LAUNCH_INTERVAL` is subtracted
from it and the next card launches. The remainder is carried, so after `t`
seconds of a running cascade exactly `floor(t / LAUNCH_INTERVAL) + 1` cards have
launched, capped at fifty-two, and the mean gap between successive launches is
`LAUNCH_INTERVAL`.

### What launches

The launch order cycles the four foundations, taking foundation `0`, then `1`,
then `2`, then `3`, then `0` again, and skipping a foundation that has been
emptied. Each launch takes the current top card of the foundation whose turn it
is, so each foundation walks its King down to its Ace over its turns, and the
cascade launches all fifty-two cards.

A launched card leaves the foundation it came from and becomes a card in flight:

| Quantity | Value |
| --- | --- |
| Its top-left | The anchor of the foundation it launched from, as `specs/table.md` fixes it |
| `vy` | `LAUNCH_VY` (`-120`) |
| `vx` | A magnitude drawn uniformly from `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]` (`[180, 420]`), with a sign chosen with equal probability |

The magnitude and the sign are drawn from the game's seeded generator, as
`specs/instrumentation.md` requires. A card launched in a frame takes no motion
in that frame.

### Each frame of a running cascade

Every card in flight is advanced, in order, by these five steps, against the
frame's delta time `dt` in seconds:

1. `vy += GRAVITY * dt`, with `GRAVITY` being `1800`.
2. `x += vx * dt` and `y += vy * dt`.
3. If `y >= FLOOR_Y` (`580`) while `vy` is greater than zero, then
   `vy = -vy * BOUNCE_DAMP` with `BOUNCE_DAMP` being `0.80`, and `y = FLOOR_Y`.
   `vx` is unchanged, so the card keeps its horizontal drift and each bounce
   peaks lower than the one before it.
4. The card is stamped onto the painted layer at its position.
5. If `x + CARD_W < 0` or `x > STAGE_W`, the card retires and leaves the flight.

The launch clock is advanced after every card in flight has been advanced.

`FLOOR_Y` is `STAGE_H - CARD_H`, so a card seated on the floor has its bottom
edge on the bottom of the stage. A card in flight collides with nothing: not the
side edges, not the piles beneath it, and not another card in flight, so two
cards crossing the same point keep their velocities through the crossing and a
card driven at a side edge crosses it rather than turning.

### The painted layer

The painted layer is a persistent surface the size of the stage. It is never
cleared while the cascade runs, so the stamps a card leaves stay on the table
long after the card has moved on, the painted area grows for as long as cards are
flying, and the felt ends buried under overlapping cards.

The layer is drawn beneath the cards still on the foundations, beneath the cards
in flight, and beneath the `WIN_TEXT` message. The cards that have not launched
yet stay drawn at their foundation anchors while the cascade runs above them.

The painted layer is cleared by a new deal, as `specs/deal.md` states, and by
nothing else.

### The end of the cascade

The cascade is done once all fifty-two cards have launched and no card is in
flight. `specs/screens.md` states what the `won` screen shows from then on, and
the painted table stays behind that message.

A press anywhere, during the cascade or after it, deals a fresh game and moves to
the `playing` screen. The deal clears the painted table, as `specs/deal.md`
states.
