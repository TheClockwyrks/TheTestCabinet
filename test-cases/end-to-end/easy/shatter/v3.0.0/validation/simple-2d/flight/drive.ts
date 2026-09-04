// flight — holding a key down, and reading what the hold did. LOCAL TO THIS GROUP.
//
// `validation/simple-2d/harness.ts` presses keys (`hold`, `release`, `tap`) and
// nothing more, which is right: a key press is an atom and the harness owns
// atoms. What is here is the two shapes of HOLD the five held-key items in this
// group need — a hold that runs for a stated span, and a turn accumulated across
// one.
//
// WHY THIS IS NOT IN THE SHARED HARNESS. `controls/drive.ts` carries the same two
// shapes for its own six held-key items. The duplication is deliberate: a group's
// helpers live beside the checks that use them, so no group agent has to edit a
// file another group's checks stand on, and the shared harness stays the place
// where the ATOMS live rather than a drawer of everybody's drives.
//
// NOTHING HERE FIXES A THRESHOLD. How long a key is held, how often the facing is
// sampled, and how far a reading may sit from the specification's own arithmetic
// are each item's own figures, derived in the item that holds them. This file
// only drives and measures.

import { angleBetween } from "../geometry";
import type { Harness } from "../harness";

/**
 * Hold `code` down for `ticks` whole ticks, then let it up.
 *
 * The key goes down through the event target the engine listens on — which
 * `specs/controls.md` makes indistinguishable from a player's own key — and comes
 * up in a `finally`, so a check that failed mid-hold does not leave a key down for
 * whatever runs next.
 */
export async function holdFor(
  h: Harness,
  code: string,
  ticks: number,
): Promise<void> {
  h.hold(code);
  try {
    await h.advance(ticks);
  } finally {
    h.release(code);
  }
}

/**
 * Hold `code` down for `ticks` whole ticks, sampling the facing every `sample`
 * ticks, and hand back the total angle those samples swept, in radians, positive
 * clockwise.
 *
 * WHY AN ACCUMULATION RATHER THAN A SUBTRACTION. `specs/ship.md` turns the ship at
 * `SHIP_TURN` (`300` degrees per second) while a turn key is held, so the second
 * the two rate items hold a key for is three hundred degrees of turn. A facing is
 * an ANGLE, and `snapshot` reports it with no winding attached, so the facing at
 * the end of that second sits sixty degrees the OTHER side of where it began.
 * Subtracting the two readings and normalizing would therefore read a conformant
 * counter-clockwise turn as a clockwise one, and grade both rate items backwards
 * — and the wrong-way build is the commonest way to get rotation wrong, so it is
 * exactly the build these items must catch.
 *
 * So the sweep is accumulated out of the short-way-round step between CONSECUTIVE
 * samples, taken often enough that no one step can be mistaken for its opposite:
 * the caller's `sample` must be short enough that the build cannot sweep half a
 * turn inside it.
 *
 * The key goes down ONCE and comes up once, because `specs/controls.md` reads
 * rotation as a hold — "the ship turns and accelerates for as long as the key is
 * down". A drive that re-pressed the key between samples would be grading a
 * stream of press edges instead of the hold the specification states.
 */
export async function heldTurn(
  h: Harness,
  code: string,
  ticks: number,
  sample: number,
): Promise<number> {
  h.hold(code);
  let previous = h.snapshot().ship.angle;
  let swept = 0;
  try {
    for (let done = 0; done < ticks; done += sample) {
      await h.advance(Math.min(sample, ticks - done));
      const now = h.snapshot().ship.angle;
      swept += angleBetween(previous, now);
      previous = now;
    }
  } finally {
    h.release(code);
  }
  return swept;
}
