// instrumentation/choose-out-of-range-inert — on levelup with three offers,
// `choose(3)` and `choose(-1)` each leave the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `choose`: "An
// `index` outside `offers` leaves the state as it was".
//
// WHAT IS READ. The state, and the state alone: the sentence fixes what the
// game holds after the call and says nothing of whether the call signals. A
// build that refuses a negative index with a throw, under the general rule
// that an argument outside an operation's domain throws, and one that returns
// the state unchanged both leave the overlay exactly as it was, so a throw is
// caught and the whole snapshot is compared against the reading before either
// way.
//
// THE POSE. An isolated run, a queued level-up, and the tick that opens the
// overlay with OFFER_COUNT offers.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
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

it("leaves the overlay untouched by an out-of-range index", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers presented");

  for (const index of OUT_OF_RANGE) {
    try {
      h.debug.choose(index);
    } catch {
      // A refusal leaves the state as it was too; the state is what is read.
    }
    assertDeepEqual(
      h.snapshot(),
      overlay,
      `the snapshot across choose(${index})`,
    );
  }
  await h.tick(1);
  captureStill(h, "inert");
});
