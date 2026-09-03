// Wick — instrumentation/choose-out-of-range-inert: on `levelup` with three
// offers, `choose(3)` and `choose(-1)` each leave the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `choose(index)`):
// "An `index` outside `offers` leaves the state as it was." The comparison is
// exact equality of the documented snapshot across each call.
//
// WHY THE WORLD IS POSED AS IT IS. The overlay is opened by the real path with
// three offers, so `3` is the first index past the list and `-1` the first
// before it, the two nearest misses.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  posedState,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing on an index outside the offers", async () => {
  await isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the calls are made on");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");

  for (const index of [OFFER_COUNT, -1]) {
    try {
      await h.debug.choose(index);
    } catch {
      // A refusal leaves the state as it was too; what is read is the state.
    }
    const after = await h.snapshot();
    assertDeepEqual(
      posedState(after),
      posedState(overlay),
      `the snapshot across choose(${index})`,
    );
  }
  await captureStill(h, "inert");
});
