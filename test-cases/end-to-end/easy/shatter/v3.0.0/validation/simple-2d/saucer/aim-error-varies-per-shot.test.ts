// saucer/aim-error-varies-per-shot — the offset is drawn again for every
// shot.
//
// THE RULE. `specs/saucer.md`: the bearing is "offset by an angle DRAWN AFRESH
// FOR EVERY SHOT", and it says outright what follows — "Successive shots at a
// stationary ship therefore differ." So this item reads eight shots at a ship
// that has not moved and asks that they are not all one bearing.
//
// TWO DISTINCT BEARINGS ARE THE WHOLE OF THE ASSERTION. The draw is continuous,
// so eight shots from it never share a bearing, while the two wrong models the
// specification's sentence rules out — a build that aims dead-on, and a build
// that draws one offset and reuses it — read eight copies of one number and
// fail. How widely a build's shots scatter inside the stated range is not a
// figure `specs/saucer.md` fixes and not one a sample decides: it is the
// reviewer's to judge from the picture.
//
// TWO BEARINGS ARE DISTINCT WHEN THEY DIFFER BY MORE THAN A READING CAN. The
// bearing is read off the velocity the round is first reported with, and a build
// that lets the well act on a round in the tick it was fired hands back a bearing
// the pull has already turned by about `0.02` degrees at this distance. A quarter
// of a degree is more than ten times that, so a build with no error at all cannot
// be credited with variation the well supplied, and it is a fortieth of the
// twenty-degree range a conformant draw covers.
//
// ONE DIRECTION ONLY, AND IT IS THE ONE THE OTHER TWO CANNOT SEE. A build with no
// error at all passes `aims-at-the-ship` perfectly and passes
// `aim-error-within-10-degrees` trivially; this is the item it fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { SHOT_COUNT, readAimErrors } from "./aim";

/**
 * How far apart two bearings must be to count as two bearings, in degrees.
 *
 * A quarter of a degree: more than ten times what the well can turn a reading by
 * at this distance, and a fortieth of the range the offset is drawn from. See
 * the header.
 */
const DISTINCT_DEG = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires eight shots at a still ship along more than one bearing", async () => {
  const errors = await readAimErrors(h);
  captureStill(h, "scatter");

  assertLength(
    errors,
    SHOT_COUNT,
    "the shots the eight-shot sweep read (specs/saucer.md)",
  );

  assertGreaterThan(
    Math.max(...errors) - Math.min(...errors),
    DISTINCT_DEG,
    `the degrees between the widest two of ${SHOT_COUNT} shots at a ship ` +
      "that never moved, which an offset drawn afresh for every shot puts " +
      "apart and a fixed aim never does (specs/saucer.md)",
  );
});
