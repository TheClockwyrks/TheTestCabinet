# Spectra — Lives and the run

This file defines the lives a run carries, what costs one, the beat after a life is
lost, the extra life, and the end of a run.

## Lives

A run starts with `START_LIVES` (`3`) lives.

| What happens | Costs |
| --- | --- |
| An enemy bullet of the band opposite the ship's reaches the ship | One life |
| Any drone's body reaches the ship, of either band | One life |
| An enemy bullet of the ship's own band reaches the ship | Nothing, and it is absorbed |
| A challenge drone's body reaches the ship | Nothing |

`specs/bands.md` states which of the two a bullet is. One event costs exactly one
life, whatever else is on the field at that instant.

## The ready hold

Losing a life with lives to spare puts the live wave into its `ready` phase.

- The phase lasts `READY_HOLD` (`1.3`) seconds, then the wave returns to the `live`
  phase.
- The `ready` banner `specs/ui.md` states is shown over the field for the hold.
- The wave carries on where it was: every drone keeps its phase, its position, and
  its band, and any dive in progress runs on.
- Nothing costs a further life during the hold.
- When the hold ends, the ship reappears at the center of its lane,
  `(SHIP_X_MIN + SHIP_X_MAX) / 2`, holding the band it held.

## The extra life

A run pays exactly one extra life, when the score first reaches `EXTRA_LIFE_AT`
(`20000`).

The run carries a latch recording whether that life has been paid. It is false when
a run begins. When scoring carries the score to `EXTRA_LIFE_AT` or beyond and the
latch is false, the run adds one life and sets the latch true. While the latch is
true no further life is paid, whatever the score does afterwards.

## The end of a run

Losing a life with no life left ends the run and opens the game-over screen. That
screen reports the run's final score and the stage it reached, as `specs/ui.md`
states.
