// Wick — progression/accept-decrements-pending: accepting an offer shortens
// the queue by one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing": "Accepting decrements `pendingLevelUps`."
// `specs/instrumentation.md`, `choose(index)`: "the item is applied,
// `pendingLevelUps` falls by one", and `setPendingLevelUps(count)` poses the
// queue.
//
// THE POSE. An isolated `playing` run holding nothing with two level-ups
// queued, so one acceptance leaves a queue rather than emptying it and the
// reading is the decrement itself rather than a reset to zero.
// `setNextOffers(["glass"])` fixes the single offer to an unheld passive, which
// a free passive slot makes a candidate, so nothing about which item is taken
// varies. Every driver switch is off and the world is empty, so no gain can
// queue a further level-up between the pose and the reading.
//
// THE TOLERANCE. Exact: a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["glass"];
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves one level-up queued after one of two is accepted", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, QUEUED);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");
  assertEqual(
    overlay.run.pendingLevelUps,
    QUEUED,
    "run.pendingLevelUps on the first overlay",
  );

  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "pending");

  assertEqual(
    after.run.pendingLevelUps,
    QUEUED - 1,
    "run.pendingLevelUps after one acceptance (specs/progression.md, Choosing)",
  );
});
