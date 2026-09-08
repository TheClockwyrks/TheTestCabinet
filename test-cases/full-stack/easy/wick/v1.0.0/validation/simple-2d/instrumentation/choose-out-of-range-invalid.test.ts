// Wick — instrumentation/choose-out-of-range-invalid: on `levelup` with three
// offers, `choose(3)` and `choose(-1)` each fail loudly and leave the overlay
// exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `choose(index)`):
// "`index` is a whole number naming an offer of `offers`; an `index` outside
// that list, a negative one included, names no offer, so the call fails
// loudly, as it does whenever `offers` is empty." A call that names nothing has
// no defined state to reach, so it throws rather than passing quietly — and a
// throw changes nothing, which is read back off the snapshot either side.
//
// WHY THE WORLD IS POSED AS IT IS. The overlay is opened by the real path with
// three offers, so `3` is the first index past the list and `-1` the first
// before it, the two nearest misses.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertThrows } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OUT_OF_RANGE = [OFFER_COUNT, -1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("throws on an out-of-range index, leaving the overlay untouched", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers presented");

  for (const index of OUT_OF_RANGE) {
    assertThrows(() => h.debug.choose(index), `choose(${index})`);
    assertDeepEqual(
      h.snapshot(),
      overlay,
      `the snapshot across choose(${index})`,
    );
  }
  await h.tick(1);
  captureStill(h, "refused");
});
