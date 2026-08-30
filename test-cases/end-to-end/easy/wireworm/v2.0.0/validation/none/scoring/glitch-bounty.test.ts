// scoring/glitch-bounty — killing a glitch pays 300.
//
// `specs/scoring.md`'s table: "A glitch is destroyed" pays `SCORE_GLITCH`
// (`300`), and the paragraph under it: "A foe's bounty is paid on the bolt that
// destroys it." `specs/foes.md` fixes that one bolt destroys a glitch.
//
// THE GLITCH IS POSED WITH NEITHER OF ITS FACULTIES. What a glitch is paid for is
// its death, and neither its darting descent nor its eating of the field has any
// part in that, so it is posed holding its tile with its own behaviour off — a
// glitch that skittered would be a glitch this point had to chase, and a glitch
// that ate would be one whose meal could move the score. It stands on a tile of
// the lower board, which is where `specs/foes.md` has one live.
//
// The board holds that one foe and nothing else: no node, no worm and no second
// foe, so the only figure the score can move by is the one this point names.
//
// WHAT EVERY WRONG MODEL READS. A build that pays every foe the same bounty reads
// `200` or `1000`; one that makes a glitch take two bolts, as a dropper does,
// reads `0`; one that pays nothing reads `0`. Each is a different number from
// `300`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_GLITCH } from "../constants";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The tile the glitch stands on, in the lower board a glitch works. */
const GLITCH = { c: 20, r: 10 };

/**
 * What the shot must pay, to the point.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_GLITCH;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 300 for a glitch a bolt destroys", async () => {
  await startPlaying(h);
  await poseFoe(h, "glitch", GLITCH.c, GLITCH.r, {
    mind: false,
    travel: false,
  });

  const before = (await h.snapshot()).score;
  await shootInto(h, GLITCH.c, GLITCH.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points killing a glitch paid",
  );
});
