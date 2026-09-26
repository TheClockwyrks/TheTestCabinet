// instrumentation/set-pending-level-ups — `setPendingLevelUps(2)` on playing
// reads back 2, and the next playing tick opens the level-up overlay exactly
// as a gain does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md,
// `setPendingLevelUps`: "Sets `pendingLevelUps` to `count`, a whole number of
// at least `0`. A `playing` tick that ends with it above `0` opens the overlay
// exactly as a gain does". specs/progression.md, "The level-up overlay": "A
// `playing` tick that ends with `pendingLevelUps` above `0` runs to completion
// and then opens the overlay: `screen` becomes `levelup` with `menuIndex` `0`",
// and the overlay "offers `OFFER_COUNT` distinct candidates".
//
// THE POSE. An isolated run, the pose read back without a frame, then one
// tick: the screen is levelup, the menu index 0, the count still 2 (the one
// presented included), and the offers drawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("queues the level-ups and the next tick opens the overlay", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(QUEUED);
  const posed = h.snapshot();
  assertEqual(posed.run.pendingLevelUps, QUEUED, "pendingLevelUps read back");
  assertEqual(posed.screen, "playing", "the screen at the pose");

  const after = await h.tick(1);
  captureStill(h, "queued");

  assertEqual(after.screen, "levelup", "the screen after the next tick");
  assertEqual(after.menuIndex, 0, "menuIndex on the overlay");
  assertEqual(
    after.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps on the overlay",
  );
  assertLength(after.run.offers, OFFER_COUNT, "the offers drawn");
});
