// Wick — instrumentation/set-pending-level-ups: `setPendingLevelUps(2)` on
// `playing` reads back 2, and the next `playing` tick opens the level-up
// overlay exactly as a gain does.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setPendingLevelUps(count)`: "Sets `pendingLevelUps` to `count` ... A
// `playing` tick that ends with it above `0` opens the overlay exactly as a
// gain does." `specs/progression.md`, "The level-up overlay": "`screen`
// becomes `levelup` with `menuIndex` `0`"; the overlay offers `OFFER_COUNT`
// candidates.
//
// THE DRIVE. An isolated run, the pose read at the call, one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("queues level-ups and the next tick opens the overlay", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(QUEUED);
  const posed = h.snapshot();
  assertEqual(
    posed.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps after the pose",
  );
  assertEqual(posed.screen, "playing", "screen at the pose");

  const opened = await advanceTicks(h, 1);
  await h.frameDraw();
  captureStill(h, "queued");
  assertEqual(opened.screen, "levelup", "screen after the next playing tick");
  assertEqual(opened.menuIndex, 0, "menuIndex on the opened overlay");
  assertEqual(
    opened.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps on the opened overlay",
  );
  assertLength(opened.run.offers, OFFER_COUNT, "offers on the opened overlay");
});
