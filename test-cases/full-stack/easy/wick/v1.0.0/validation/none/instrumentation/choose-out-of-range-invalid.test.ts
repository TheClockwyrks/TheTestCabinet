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
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertRejects,
} from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  posedState,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on an index outside the offers, changing nothing", async () => {
  await isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the calls are made on");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");

  for (const index of [OFFER_COUNT, -1]) {
    await assertRejects(() => h.debug.choose(index), `choose(${index})`);
    assertDeepEqual(
      posedState(await h.snapshot()),
      posedState(overlay),
      `the snapshot across choose(${index})`,
    );
  }
  await captureStill(h, "refused");
});
