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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws for an index past the end or below zero", async () => {
  isolate(h);
  const before = await openLevelUp(h, 1);
  assertLength(before.run.offers, OFFER_COUNT, "offers on the open overlay");

  assertThrows(() => h.debug.choose(OFFER_COUNT), "choose(3)");
  const afterPast = h.snapshot();
  assertThrows(() => h.debug.choose(-1), "choose(-1)");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");

  assertDeepEqual(afterPast, before, "snapshot after choose(3)");
  assertDeepEqual(after, before, "snapshot after choose(-1)");
});
