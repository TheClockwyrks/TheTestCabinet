// scoring/corruptor-bounty — killing a corruptor pays 1000.
//
// `specs/scoring.md`'s table: "A corruptor is destroyed" pays
// `SCORE_CORRUPTOR` (`1000`), and the paragraph under it: "A foe's bounty is paid
// on the bolt that destroys it." `specs/foes.md` fixes that one bolt destroys a
// corruptor.
//
// THE CORRUPTOR IS POSED WITH NEITHER OF ITS FACULTIES. What a corruptor is paid
// for is its death, and neither its crawl across the board nor its slamming of
// the field to critical has any part in that, so it is posed holding its tile
// with its own behaviour off. It stands on a row of the upper board, which is
// where `specs/foes.md` has one enter and hold.
//
// The board holds that one foe and nothing else: no node, no worm and no second
// foe, so the only figure the score can move by is the one this point names — and
// with no node under it, a build whose slam ran anyway could not move the score
// through the field either.
//
// WHAT EVERY WRONG MODEL READS. A build that pays every foe the same bounty reads
// `300` or `200`; one that makes a corruptor take two bolts, as a dropper does,
// reads `0`; one that pays nothing reads `0`. Each is a different number from
// `1000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_CORRUPTOR } from "../constants";
import {
  captureStill,
  createHarness,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The tile the corruptor stands on, on a row of the upper board it crawls. */
const CORRUPTOR = { c: 20, r: 3 };

/**
 * What the shot must pay, to the point.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_CORRUPTOR;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 1000 for a corruptor a bolt destroys", async () => {
  await startPlaying(h);
  await poseFoe(h, "corruptor", CORRUPTOR.c, CORRUPTOR.r, {
    mind: false,
    travel: false,
  });

  const before = (await h.snapshot()).score;
  await shootInto(h, CORRUPTOR.c, CORRUPTOR.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points killing a corruptor paid",
  );
});
