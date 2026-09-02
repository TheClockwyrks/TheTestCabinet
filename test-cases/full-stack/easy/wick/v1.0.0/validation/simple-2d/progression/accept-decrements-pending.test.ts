// progression/accept-decrements-pending — accepting an offer takes one level-up
// off the queue.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "Accepting
// decrements pendingLevelUps. When level-ups remain queued the next overlay
// opens immediately, with a fresh pool drawn from the slots as the acceptance
// left them". specs/instrumentation.md, choose: "the item is applied,
// pendingLevelUps falls by one, and either the next queued overlay opens with a
// fresh pool or screen returns to playing."
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off. Two level-ups are queued through
// setPendingLevelUps, of which "A playing tick that ends with it above 0 opens
// the overlay exactly as a gain does" (specs/instrumentation.md), and the
// playing tick that opens the overlay is run. choose(0) then accepts the first
// offer; with nothing held the pool is the twenty new items, so an offer stands
// at index 0 whatever the draw gave.
//
// THE TOLERANCE. None: the queue is a whole count. A build that never
// decrements reads 2, and one that empties the queue on the first acceptance
// reads 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level-ups queued before the acceptance. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads pendingLevelUps 1 after one acceptance with two queued", async () => {
  isolate(h);

  const overlay = await openLevelUp(h, QUEUED);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertEqual(overlay.run.pendingLevelUps, QUEUED, "the queue on the overlay");
  assertGreaterThan(overlay.run.offers.length, 0, "an offer to accept");
  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "pending");

  assertEqual(
    after.run.pendingLevelUps,
    QUEUED - 1,
    "the queue after the acceptance",
  );
});
