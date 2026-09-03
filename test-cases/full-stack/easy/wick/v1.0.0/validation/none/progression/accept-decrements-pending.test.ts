// progression/accept-decrements-pending — accepting an offer decrements
// pendingLevelUps.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"):
// "Accepting decrements `pendingLevelUps`." specs/instrumentation.md says the
// same of the operation the acceptance goes through: `choose(index)` "accepts
// the offer at `index` ... the item is applied, `pendingLevelUps` falls by one".
// So a queue of `2` reads `1` after one acceptance.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and no slot held, so the pool is every candidate and the
// overlay has three offers to accept from. The queue is posed at `2` rather than
// `1` because that separates the decrement from the closing rule: at `1` a build
// that clears the queue rather than lowering it reads the same `0` a correct
// build reads, and at `2` it reads `0` where a correct build reads `1`. The
// second overlay that opens on the acceptance is
// `progression/pool-recomputed-after-accept`'s point, not this one.
//
// THE TOLERANCE. None: a queue length is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level-ups queued: two, so a decrement and a clear read differently. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers the queue by one when an offer is accepted", async () => {
  await isolate(h);

  const overlay = await openLevelUp(h, QUEUED);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-ups opened",
  );
  assertEqual(
    overlay.run.pendingLevelUps,
    QUEUED,
    "the queue before the acceptance",
  );
  assertGreaterThan(
    overlay.run.offers.length,
    0,
    "the offers the overlay presents",
  );

  await h.debug.choose(0);
  const after = await h.snapshot();
  await captureStill(h, "pending");

  assertEqual(
    after.run.pendingLevelUps,
    QUEUED - 1,
    "the queue after one acceptance",
  );
});
