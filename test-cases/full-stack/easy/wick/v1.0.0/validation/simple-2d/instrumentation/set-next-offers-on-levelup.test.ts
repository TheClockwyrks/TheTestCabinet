// instrumentation/set-next-offers-on-levelup — `setNextOffers` issued while
// on levelup with another level-up queued is presented by the next overlay
// that `choose` opens.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setNextOffers`:
// "Applies on a run screen and on `levelup`, where the next overlay is the
// queued one".
//
// THE POSE. An isolated run, a first list so the first overlay's offers are
// known, two level-ups queued. On the open overlay a second list of ids the
// coming choice leaves as candidates, then `choose(0)`: the next overlay
// presents the second list exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import type { OfferId } from "../surface";

const FIRST: OfferId[] = ["ember", "pin", "wick"];
const QUEUED: OfferId[] = ["spark", "glass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("presents the list posed on levelup in the queued overlay", async () => {
  isolate(h);
  h.debug.setNextOffers(FIRST);
  const first = await openLevelUp(h, 2);
  assertDeepEqual(first.run.offers, FIRST, "the first overlay's offers");

  h.debug.setNextOffers(QUEUED);
  assertDeepEqual(
    h.snapshot().run.nextOffers,
    QUEUED,
    "nextOffers posed on levelup",
  );
  h.debug.choose(0);
  const second = h.snapshot();
  await h.tick(1);
  captureStill(h, "queued");

  assertEqual(second.screen, "levelup", "the queued overlay opened by choose");
  assertDeepEqual(second.run.offers, QUEUED, "the queued overlay's offers");
});
