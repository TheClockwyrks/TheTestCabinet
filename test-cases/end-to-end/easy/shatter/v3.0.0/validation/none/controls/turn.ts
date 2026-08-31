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
// IT MEASURES AND ASSERTS NOTHING. What counts as having turned, and how far a
// released ship may still drift, are each item's own figures, derived in the item
// that holds them.

import { angleDelta } from "../geometry";
import type { Harness } from "../harness";

/** What a held turn came to: the winding-aware total, and the facing it ended on. */
export interface HeldTurn {
  /** The signed turn accumulated across the hold, in radians, clockwise positive. */
  turned: number;
  /** The facing the last sample read, in radians. */
  angle: number;
}

/**
 * Hold `code` down for `ticks` real ticks, sampling the facing every `sample`
 * ticks, and hand back the turn those samples add up to.
 *
 * The key goes down through Chromium's own input pipeline and comes up in a
 * `finally`, so a check that failed mid-hold does not leave a key down for the
 * next thing this page does.
 */
export async function heldTurn(
  h: Harness,
  code: string,
  ticks: number,
  sample: number,
): Promise<HeldTurn> {
  await h.hold(code);
  let angle = (await h.snapshot()).ship.angle;
  let turned = 0;
  try {
    for (let done = 0; done < ticks; done += sample) {
      await h.advance(Math.min(sample, ticks - done));
      const now = (await h.snapshot()).ship.angle;
      turned += angleDelta(angle, now);
      angle = now;
    }
  } finally {
    await h.release(code);
  }
  return { turned, angle };
}
