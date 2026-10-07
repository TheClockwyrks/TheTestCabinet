// Wick — instrumentation/set-pending-level-ups: `setPendingLevelUps(2)` on
// `playing` reads back 2, and the next `playing` tick opens the level-up
// overlay exactly as a gain does.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setPendingLevelUps(count)`): "Sets `pendingLevelUps` to `count`, a whole
// number of at least `0`. A `playing` tick that ends with it above `0` opens
// the overlay exactly as a gain does." specs/progression.md: the overlay opens
// with "`screen` ... `levelup` with `menuIndex` `0`" and "offers `OFFER_COUNT`
// distinct candidates".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so the one tick after
// the pose has nothing to do but open the overlay; the count is read at the
// pose, before the tick, so a build that opened it at the call is caught too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("queues level-ups, and the next tick opens the overlay", async () => {
  await isolate(h);
  await h.debug.setPendingLevelUps(QUEUED);
  const posed = await h.snapshot();
  assertEqual(
    posed.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps after the pose",
  );
  assertEqual(
    posed.screen,
    "playing",
    "the screen at the pose, before the tick",
  );

  const opened = await h.step(1);
  await captureStill(h, "queued");
  assertEqual(
    opened.screen,
    "levelup",
    "the screen after the next playing tick",
  );
  assertEqual(opened.menuIndex, 0, "menuIndex on the opened overlay");
  assertEqual(
    opened.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps on the open overlay",
  );
  assertLength(opened.run.offers, OFFER_COUNT, "the offers the overlay drew");
});
