// Wick — instrumentation/choose-out-of-range-inert: on `levelup` with three
// offers, `choose(3)` and `choose(-1)` each leave the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `choose(index)`: "An `index` outside `offers` leaves the state as it was."
// That is the operation's own rule for an index that names no offer, stated
// as an inert call rather than as an invalid argument, so `3` past the three
// offers and `-1` before them both return with nothing changed.
//
// THE POSE. An isolated run holding nothing, the overlay opened by the real
// tick with its three drawn offers; each call is followed by a structural
// comparison of the whole snapshot against the one before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
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

it("changes nothing for an index past the end or below zero", async () => {
  isolate(h);
  const before = await openLevelUp(h, 1);
  assertLength(before.run.offers, OFFER_COUNT, "offers on the open overlay");

  // Inert rather than invalid: the operation's own heading makes an index
  // outside `offers` a call that changes nothing, so a throw fails here too.
  // Each call's outcome is kept and judged after the still, so a failing
  // verdict still leaves the picture of the overlay the calls were made on.
  const past = outcomeOf(() => h.debug.choose(OFFER_COUNT));
  const afterPast = h.snapshot();
  const below = outcomeOf(() => h.debug.choose(-1));
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "inert");

  assertNull(past, "the error choose(3) threw");
  assertDeepEqual(afterPast, before, "snapshot after choose(3)");
  assertNull(below, "the error choose(-1) threw");
  assertDeepEqual(after, before, "snapshot after choose(-1)");
});

/** What a call threw, as its message, or `null` when it returned. */
function outcomeOf(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
