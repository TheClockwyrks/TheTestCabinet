// instrumentation/set-next-offers-presented — a list of 1 to 3 distinct ids,
// every one a candidate of the pool when the next level-up overlay opens, is
// presented as given, in that order.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setNextOffers`:
// "Sets `nextOffers` to `ids`, a list of `1` to `OFFER_COUNT` (`3`) distinct
// ids ... The list is checked against the candidate pool at the moment the
// next level-up overlay opens: it is accepted when every id is a candidate of
// the pool at that moment ... and the overlay then presents exactly that list
// in that order".
//
// THE POSE. An isolated run holding Taper, so `taper` is a +1 candidate and
// every unheld item a new one. A three-list in an order no fixed ordering
// would produce, then the overlay by the real path; then, from a fresh scene,
// a one-list, so both ends of the length range are read.

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

const THREE: OfferId[] = ["wick", "taper", "ember"];
const ONE: OfferId[] = ["lure"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("presents the posed list as given", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setNextOffers(THREE);
  assertDeepEqual(h.snapshot().run.nextOffers, THREE, "nextOffers read back");
  const three = await openLevelUp(h, 1);
  captureStill(h, "presented");
  assertEqual(three.screen, "levelup", "the overlay opened");
  assertDeepEqual(
    three.run.offers,
    THREE,
    "the offers, the posed three in order",
  );

  isolate(h, { keepTaper: true });
  h.debug.setNextOffers(ONE);
  const one = await openLevelUp(h, 1);
  assertDeepEqual(one.run.offers, ONE, "the offers, the posed one alone");
});
