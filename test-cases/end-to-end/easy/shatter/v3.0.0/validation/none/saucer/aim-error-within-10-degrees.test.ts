// Shatter — saucer/aim-error-within-10-degrees: no shot strays past the bound.
//
// THE RULE. `specs/saucer.md` draws the per-shot offset "uniformly from
// `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR` (`10` degrees)". This item is the
// bound alone: the WIDEST any one of eight shots stood off the bearing to the
// ship.
//
// ONE DIRECTION ONLY. Where the shots are centred is `aims-at-the-ship`'s and
// whether they scatter at all is `aim-error-varies-per-shot`'s, so a build that
// fires dead-on every time passes this one — it has never left the bound — and
// fails the other. A build drawing its error over `+/-30` degrees fails only this
// one. Three faults, three items, three verdicts.
//
// A HANDFUL OF SHOTS, EACH HELD TO THE BOUND. Eight unposed draws are enough to
// decide that a build's shots leave inside the range the specification names: a
// build aiming freely, or drawing over `+/-30` degrees, puts most of its shots
// past ten and fails on the first of them. A build whose range is only slightly
// too wide strays past the bound on a fraction of its draws, and eight is a
// handful rather than a sample: how a build's draw is shaped inside the stated
// range is the reviewer's to judge, not a figure a sample decides.
//
// WHY HALF A DEGREE. Not slack in the rule — a build drawing from the stated range
// never reaches `10` — but the reading's own error. The bearing is read off the
// velocity the round is first reported with, and a build that lets the well act on
// a round in the tick it was fired hands back a bearing the pull has already turned
// by about `0.02` degrees at this distance. Half a degree is twenty-five times
// that, and it is a twentieth of the way to the nearest wrong draw width.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { SAUCER_AIM_ERROR_DEG } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { SHOT_COUNT, readAimErrors } from "./aim";

/** Half a degree, for what the reading itself can add. See the header. */
const READING_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every one of eight shots inside SAUCER_AIM_ERROR", async () => {
  const errors = await readAimErrors(h);
  await captureStill(h, "aim");

  assertLength(
    errors,
    SHOT_COUNT,
    "the shots the eight-shot sweep read (specs/saucer.md)",
  );

  const widest = Math.max(...errors.map((error) => Math.abs(error)));
  assertLessThanOrEqual(
    widest,
    SAUCER_AIM_ERROR_DEG + READING_TOLERANCE,
    `the degrees the widest of ${SHOT_COUNT} shots stood off the bearing to ` +
      "the ship (specs/saucer.md)",
  );
});
