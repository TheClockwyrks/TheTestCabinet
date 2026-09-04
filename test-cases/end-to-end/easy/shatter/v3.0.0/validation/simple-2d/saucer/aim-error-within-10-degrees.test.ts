// saucer/aim-error-within-10-degrees — no shot strays past the bound.
//
// THE RULE. `specs/saucer.md` draws the per-shot offset "uniformly from
// `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR` (`10` degrees)". This item is the
// bound alone: the WIDEST any one of sixty shots stood off the bearing to the
// ship.
//
// ONE DIRECTION ONLY. Where the shots are centred is `aims-at-the-ship`'s and
// whether they scatter at all is `aim-error-varies-per-shot`'s, so a build that
// fires dead-on every time passes this one — it has never left the bound — and
// fails the other. A build drawing its error over `+/-30` degrees fails only this
// one. Three faults, three items, three verdicts.
//
// SIXTY SHOTS IS WHAT MAKES THE BOUND WORTH ASSERTING. The largest of sixty
// uniform draws lands about `9.84` degrees out, so the sample really does press
// against the bound; a build drawing over `+/-15` degrees puts about a third of
// its shots past it and fails on the first handful.
//
// WHY HALF A DEGREE. Not slack in the rule — a build drawing from the stated
// range never reaches `10` — but the reading's own error. The bearing is read off
// the velocity the round is first reported with, and a build that lets the well
// act on a round in the tick it was fired hands back a bearing the pull has
// already turned by about `0.02` degrees at this distance. Half a degree is
// twenty-five times that, and it is a twentieth of the way to the nearest wrong
// draw width.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SAUCER_AIM_ERROR_DEG, SHOT_COUNT, readAimErrors } from "./aim";

/** Half a degree, for what the reading itself can add. See the header. */
const READING_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every one of sixty shots inside SAUCER_AIM_ERROR", async () => {
  const errors = await readAimErrors(h);
  captureStill(h, "aim");

  assertLength(
    errors,
    SHOT_COUNT,
    "the shots the sixty-shot sweep read (specs/saucer.md)",
  );

  const widest = Math.max(...errors.map((error) => Math.abs(error)));
  assertLessThanOrEqual(
    widest,
    SAUCER_AIM_ERROR_DEG + READING_TOLERANCE,
    `the degrees the widest of ${SHOT_COUNT} shots stood off the bearing to ` +
      "the ship (specs/saucer.md)",
  );
});
