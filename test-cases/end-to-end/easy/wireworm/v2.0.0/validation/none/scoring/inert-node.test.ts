// scoring/inert-node — a bolt that shoots down an inert node pays 1.
//
// `specs/scoring.md`'s table: "A bolt removes an inert node" pays
// `SCORE_INERT_NODE` (`1`). `specs/nodes.md`'s bolt table is what makes this
// event a removal: a bolt into a charge `0` node leaves its tile empty.
//
// THE BOARD HOLDS ONE NODE AND NOTHING ELSE. No worm, no foe and no second node,
// so the only thing in the column the bolt climbs is the node the point is
// about, and the only figure the score can move by is the one this point names.
//
// WHAT EVERY WRONG MODEL READS. A build that pays a discharge's purge figure for
// any node it removes reads `5`; one that pays a segment figure reads `10` or
// `100`; one that pays nothing — treating the inert node as terrain that scores
// like a de-energizing does — reads `0`. Each is a different number from `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_INERT_NODE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The tile the inert node stands on. */
const NODE = { c: 14, r: 8 };

/** Inert: the charge `specs/nodes.md` says a bolt removes the node at. */
const INERT = 0;

/**
 * What the shot must pay, to the point.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_INERT_NODE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 1 for an inert node a bolt removes", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE.c, NODE.r, INERT);

  const before = (await h.snapshot()).score;
  await shootInto(h, NODE.c, NODE.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points a bolt into an inert node paid",
  );
});
