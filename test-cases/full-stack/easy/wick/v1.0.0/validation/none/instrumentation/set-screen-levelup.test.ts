// Wick — instrumentation/set-screen-levelup: on `playing` with a level-up
// queued, `setScreen("levelup")` opens the overlay exactly as the end of a
// `playing` tick does: `screen` `levelup` with `menuIndex` `0`, the pool
// computed from the slots, and `offers` drawn from it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `levelup | playing, with pendingLevelUps at least 1` row: "Opens the
// overlay exactly as the end of a `playing` tick opens it: the pool is
// computed, `nextOffers` is consumed or the draw is made, and `offers` is
// filled." The pool rule is specs/progression.md's, restated by
// `candidatePool`; "The overlay offers `OFFER_COUNT` distinct candidates drawn
// ... from the pool".
//
// WHY THE WORLD IS POSED AS IT IS. A level-up is queued through its own pose
// and the call made with no tick run, so the overlay is the call's and the
// clock stands where it did; the loadout is left empty, so the pool is the
// whole roster and a draw of three from it is easy to read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEachIn,
  assertEqual,
  assertLength,
} from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  candidatePool,
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the level-up overlay with a computed pool and drawn offers", async () => {
  const posed = await isolate(h);
  await h.debug.setPendingLevelUps(1);

  const overlay = await poseScreen(h, "levelup");
  await captureStill(h, "overlay");

  assertEqual(overlay.screen, "levelup", "the screen after setScreen('levelup')");
  assertEqual(overlay.menuIndex, 0, "menuIndex on the opened overlay");
  assertEqual(overlay.run.tick, posed.run.tick, "the run clock, no tick run");
  assertEqual(overlay.run.pendingLevelUps, 1, "pendingLevelUps, still queued");
  assertDeepEqual(
    overlay.run.pool,
    candidatePool(posed),
    "the pool computed from the slots",
  );
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers drawn");
  assertEachIn(overlay.run.offers, overlay.run.pool, "each offer in the pool");
  assertEqual(
    new Set(overlay.run.offers).size,
    overlay.run.offers.length,
    "distinct offers",
  );
});
