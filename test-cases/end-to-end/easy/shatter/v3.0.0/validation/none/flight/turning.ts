// flight — reading a held rotation back off the facing.
//
// WHY THE TURN IS ACCUMULATED RATHER THAN SUBTRACTED. `specs/ship.md` fixes the
// rotation at `SHIP_TURN` (`300` degrees per second), so a second of a held turn
// key moves the facing by 300 degrees — and an angle is periodic, so the facing a
// build ends on cannot tell that turn from any other differing by a whole turn.
// The two readings a single subtraction confuses are exactly the two a check here
// must tell apart: a build that turned 300 degrees counter-clockwise and a build
// that turned 60 degrees clockwise end on the SAME facing, and a build that turned
// the right amount the wrong way is the commonest way to get this wrong.
//
// So the facing is sampled while the key is down, at a stride short enough that no
// single step can cover half a turn, and the signed short-way difference between
// consecutive samples is summed. What comes back is the total swept angle, sign
// and all, however many whole turns it covers.
//
// NO THRESHOLD LIVES HERE. The stride and the span are the caller's, and so is
// every bound: this file only measures.

import { angleDelta } from "../geometry";
import type { Harness } from "../harness";

/**
 * Hold `code` for `ticks` ticks and hand back the total angle the facing swept,
 * in radians, positive clockwise.
 *
 * The key goes down once and comes up once, because `specs/controls.md` reads
 * rotation as a HOLD: a check that re-pressed the key between samples would be
 * grading a stream of press edges instead. The facing is read every `stride`
 * ticks, which must be short enough that the build cannot sweep half a turn
 * between two of them.
 */
export async function accumulateTurn(
  h: Harness,
  code: string,
  ticks: number,
  stride: number,
): Promise<number> {
  let previous = (await h.snapshot()).ship.angle;
  let swept = 0;
  await h.hold(code);
  try {
    for (let run = 0; run < ticks; run += stride) {
      await h.advance(Math.min(stride, ticks - run));
      const angle = (await h.snapshot()).ship.angle;
      swept += angleDelta(previous, angle);
      previous = angle;
    }
  } finally {
    await h.release(code);
  }
  return swept;
}
