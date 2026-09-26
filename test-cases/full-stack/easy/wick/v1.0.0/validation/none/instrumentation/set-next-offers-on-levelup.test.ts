// Wick — instrumentation/set-next-offers-on-levelup: `setNextOffers` issued
// while on `levelup` with another level-up queued is presented by the next
// overlay that `choose` opens.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "Called on `levelup`, the overlay the list is checked
// against is the queued one." And `choose`: "either the next queued
// overlay opens with a fresh pool or `screen` returns to `playing`."
//
// WHY THE WORLD IS POSED AS IT IS. Two level-ups are queued and the first
// overlay opened by the real path; three passives, each a candidate whatever
// the first choice applies (a passive chosen at level 1 is still a `+1`
// candidate, and the passive slots stay free), are queued while the overlay is
// open, so the second overlay must present exactly them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const QUEUED: OfferId[] = ["oil", "lure", "glass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fixes the queued overlay when posed on levelup", async () => {
  await isolate(h);
  const first = await openLevelUp(h, 2);
  assertEqual(first.screen, "levelup", "the screen the pose is made on");
  assertEqual(first.run.pendingLevelUps, 2, "level-ups queued at the pose");

  await h.debug.setNextOffers(QUEUED);
  const posed = await h.snapshot();
  assertDeepEqual(
    posed.run.nextOffers,
    QUEUED,
    "nextOffers after the pose on levelup",
  );

  await h.debug.choose(0);
  const second = await h.snapshot();
  await captureStill(h, "queued");
  assertEqual(
    second.screen,
    "levelup",
    "the screen after choose with one more queued",
  );
  assertDeepEqual(second.run.offers, QUEUED, "the queued overlay's offers");
});
