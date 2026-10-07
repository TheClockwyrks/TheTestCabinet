// scoring/dropper-bounty — killing a dropper pays 200, across its two bolts.
//
// `specs/scoring.md`'s table: "A dropper is destroyed" pays `SCORE_DROPPER`
// (`200`), and the paragraph under it names this foe in particular: "A foe's
// bounty is paid on the bolt that destroys it, so the first bolt into a dropper
// pays nothing and the second pays `SCORE_DROPPER`." `specs/foes.md` fixes that
// a dropper takes two bolts, the first of which only marks it.
//
// THE READING IS TAKEN ACROSS BOTH BOLTS, which is what makes the figure the
// bounty rather than the bounty plus whatever a first bolt wrongly paid: a build
// that pays `200` on each of the two reads `400`, and a build that pays it on the
// first and destroys the dropper there reads `200` and passes, because paying
// once for one dropper is what this point is about and surviving its first bolt
// is `foes.dropper-first-bolt-survives`'s.
//
// THE DROPPER IS POSED WITH NEITHER OF ITS FACULTIES. What a dropper is paid for
// is its death, and neither its fall — which its first bolt quickens — nor its
// laying of nodes has any part in that, so it is posed holding its tile with its
// own behaviour off. That is also what keeps the second bolt's target where the
// first left it, without this point having to demand a fall speed of the build:
// a moving dropper would make the check secretly assert `DROPPER_SPEED_HIT`,
// which is `foes.dropper-first-bolt-speeds-up`'s requirement.
//
// The board holds that one foe and nothing else, so the only figure the score can
// move by is the one this point names — and with no empty tile beneath it holding
// a laid node, a build whose laying ran anyway could not move the score through
// the field either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_DROPPER } from "../constants";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The tile the dropper stands on. */
const DROPPER = { c: 20, r: 10 };

/**
 * What the two shots must pay between them, to the point.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_DROPPER;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 200 across the two bolts that destroy a dropper", async () => {
  await startPlaying(h);
  await poseFoe(h, "dropper", DROPPER.c, DROPPER.r, {
    mind: false,
    travel: false,
  });

  const before = (await h.snapshot()).score;
  await shootInto(h, DROPPER.c, DROPPER.r);
  await shootInto(h, DROPPER.c, DROPPER.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points the two bolts into a dropper paid between them",
  );
});
