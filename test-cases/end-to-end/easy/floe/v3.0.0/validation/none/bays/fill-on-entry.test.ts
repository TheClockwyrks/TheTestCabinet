// bays/fill-on-entry — the hop that lands in an open bay fills that bay, and
// leaves every other bay exactly as it was.
//
// specs/bays.md: "A crossing ends on the hop that lands the critter in an open
// bay, which is a hop up from row `2`. On that hop: that bay becomes filled, and
// no other bay changes."
//
// The bay under test is bay `3`, whose columns are `27` and `28`
// (specs/strait.md). Its index is neither `0` nor the middle, and it is neither
// of the columns it is reached from, so a build that fills the first bay, or the
// bay whose index it read off the column, or every bay at once, reads a different
// array from the one below rather than the same one.
//
// The whole five-entry array is read rather than the one bay, because "and no
// other bay changes" is half of what this point decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { BAY_COUNT, HOP_KEY } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The bay this point fills. */
const BAY = 3;

/** The five bays afterwards: that one filled, the other four untouched. */
const EXPECTED: boolean[] = Array.from(
  { length: BAY_COUNT },
  (_, index) => index === BAY,
);

/**
 * Ticks of the bay-fill hold recorded after the hop, for the replay alone.
 *
 * A quarter of a second, so the evidence shows the critter arriving in the bay
 * and the strait carrying on rather than a single frozen frame. Every reading is
 * taken before it runs.
 */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fills the bay the hop landed in, and no other", async () => {
  await startCrossing(h);
  await poseAtBayMouth(h, BAY);

  const filled = await captureReplay(h, "fill", async () => {
    await h.tap(HOP_KEY.up);
    const landed = await h.snapshot();
    await h.advance(AFTER_TICKS);
    return landed;
  });

  // The array alone is the whole verdict: a hop that was refused leaves all five
  // open, a hop that filled the wrong bay reads a different index, and a build
  // that filled more than one reads more than one. Nothing is read off the
  // critter, which `specs/bays.md` has left the strait by now.
  assertDeepEqual(filled.bays, EXPECTED, `only bay ${BAY} filled`);
});
