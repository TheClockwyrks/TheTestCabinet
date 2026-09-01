// Wick — instrumentation/set-next-offers-presented: a list of 1 to 3 distinct
// ids, every one a candidate of the pool when the next level-up overlay opens,
// is presented as given, in that order.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "Sets `nextOffers` to `ids`, a list of `1` to
// `OFFER_COUNT` (`3`) distinct ids ... it is accepted when every id is a
// candidate of the pool at that moment ... and the overlay then presents
// exactly that list in that order." The snapshot reports "`nextOffers` | what
// `setNextOffers` queued".
//
// WHY THE WORLD IS POSED AS IT IS. The loadout is empty, so every weapon and
// passive id is a candidate; a two-id list in an order that is not the pool's
// (a passive first, then a weapon) is queued, so a build presenting three, or
// presenting the pool's order, fails. The overlay is opened by the real path.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const QUEUED: OfferId[] = ["tinder", "shard"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("presents a queued list of candidates as given", async () => {
  await isolate(h);
  await h.debug.setNextOffers(QUEUED);
  const queued = await h.snapshot();
  assertDeepEqual(queued.run.nextOffers, QUEUED, "nextOffers after the pose");

  const overlay = await openLevelUp(h);
  await captureStill(h, "presented");
  assertEqual(overlay.screen, "levelup", "the screen the queued level-up opened");
  assertDeepEqual(overlay.run.offers, QUEUED, "the offers the overlay presents");
});
