// Wick — instrumentation/set-next-offers-on-levelup: `setNextOffers` issued
// on `levelup` with another level-up queued is presented by the next overlay
// that `choose` opens.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setNextOffers(ids)`: "Applies on a run screen and on `levelup`, where the
// next overlay is the queued one." `choose(index)`: "either the next queued
// overlay opens with a fresh pool".
//
// THE DRIVE. An isolated run holding nothing with two level-ups queued, the
// first overlay opened by the real tick and drawn at random; on it, a list of
// three that stay candidates whatever `choose(0)` takes (a weapon taken at
// level 1 or a passive taken at level 1 is still a `+1` candidate, and the
// slots stay free); then `choose(0)`, and the second overlay's offers.

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

const QUEUED: OfferId[] = ["spark", "soot", "glass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fixes the queued overlay's offers from levelup", async () => {
  isolate(h);
  const first = await openLevelUp(h, 2);
  assertEqual(first.screen, "levelup", "screen on the first overlay");

  h.debug.setNextOffers(QUEUED);
  assertDeepEqual(
    h.snapshot().run.nextOffers,
    QUEUED,
    "run.nextOffers posed on levelup",
  );
  h.debug.choose(0);
  const second = h.snapshot();
  await h.frameDraw();
  captureStill(h, "queued");

  assertEqual(second.screen, "levelup", "screen on the queued overlay");
  assertEqual(
    second.run.pendingLevelUps,
    1,
    "pendingLevelUps on the queued overlay",
  );
  assertDeepEqual(second.run.offers, QUEUED, "the queued overlay's offers");
});
