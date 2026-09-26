// Shatter — controls: reading a turn taken while a key is held. CASE-PROVIDED.
//
// The one thing the four rotation items in this group share, and the reason it is
// a helper rather than four copies of a loop.
//
// WHY AN ACCUMULATION RATHER THAN A SUBTRACTION. `specs/ship.md` turns the ship at
// `SHIP_TURN` (`300` degrees per second) while a turn key is held, so the second
// `controls/rotate-left-arrow` and `controls/rotate-right-arrow` hold a key for is
// three hundred degrees of turn. A facing is an ANGLE, and `snapshot` reports it in
// radians with no winding attached, so the facing at the end of that second sits
// sixty degrees the OTHER side of where it began. Subtracting one reading from the
// other and normalizing would therefore read a conformant counter-clockwise turn as
// a clockwise one and grade all four items backwards.
//
// So the turn is accumulated out of the short-way-round step between CONSECUTIVE
// samples, taken often enough that no one step can be mistaken for its opposite: at
// `SHIP_TURN` a four-tick step is ten degrees, and a step would have to reach a
// hundred and eighty before the short way round is the wrong way round.
//
// WHAT IT HANDS BACK, BEYOND THE TOTAL. Each sample's own signed step, and the
// extremes among them. `specs/ship.md` fixes a held turn as CONSTANT and in one
// direction, so no step of a conformant hold goes the other way — and the total
// alone cannot say that: a build that swung the ship one way and part of the way
// back reaches a total of the right sign, as does one whose facing is stepped by a
// rounding rather than by a rate.
//
// IT MEASURES AND ASSERTS NOTHING. What counts as having turned, and how far a
// released ship may still drift, are each item's own figures, derived in the item
// that holds them.

import { angleDelta } from "../geometry";
import type { Harness } from "../harness";

/** What a turn came to: the winding-aware total, the steps, and the facing it ended on. */
export interface HeldTurn {
  /** The signed turn accumulated across the span, in radians, clockwise positive. */
  turned: number;
  /** Each sample step's signed turn, in radians. Positive is CLOCKWISE. */
  steps: number[];
  /** The largest single step's turn, signed. Positive is CLOCKWISE. */
  mostClockwise: number;
  /** The smallest single step's turn, signed. Negative is COUNTER-CLOCKWISE. */
  mostCounterClockwise: number;
  /** The facing the last sample read, in radians. */
  angle: number;
}

/**
 * Hold `code` down for `ticks` real ticks, sampling the facing every `sample`
 * ticks, and hand back the turn those samples add up to — or, where `code` is
 * omitted, read the same span with NOTHING held, which is how the four rotation
 * items establish that the facing is still before a key reaches it.
 *
 * The key goes down through Chromium's own input pipeline and comes up in a
 * `finally`, so a check that failed mid-hold does not leave a key down for the
 * next thing this page does.
 */
export async function heldTurn(
  h: Harness,
  code: string | undefined,
  ticks: number,
  sample: number,
): Promise<HeldTurn> {
  if (code !== undefined) await h.hold(code);
  let angle = (await h.snapshot()).ship.angle;
  const steps: number[] = [];
  try {
    for (let done = 0; done < ticks; done += sample) {
      await h.advance(Math.min(sample, ticks - done));
      const now = (await h.snapshot()).ship.angle;
      steps.push(angleDelta(angle, now));
      angle = now;
    }
  } finally {
    if (code !== undefined) await h.release(code);
  }
  return {
    turned: steps.reduce((sum, step) => sum + step, 0),
    steps,
    mostClockwise: steps.length === 0 ? 0 : Math.max(...steps),
    mostCounterClockwise: steps.length === 0 ? 0 : Math.min(...steps),
    angle,
  };
}
