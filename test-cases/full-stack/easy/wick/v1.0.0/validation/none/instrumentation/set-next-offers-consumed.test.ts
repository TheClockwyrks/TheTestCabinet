// Wick — instrumentation/set-next-offers-consumed: after the overlay a
// `setNextOffers` list applied to has opened, `nextOffers` reads `null` and the
// next level-up overlay draws at random.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "One overlay consumes it, and a later overlay draws at
// random again." specs/progression.md: the draw is "`OFFER_COUNT` distinct
// candidates drawn ... from the pool", and "every candidate in a pool smaller
// than `OFFER_COUNT` is offered".
//
// WHY THE WORLD IS POSED AS IT IS. A one-id list is queued, so the overlay it
// applies to presents one offer, and a second overlay that still presented one
// would be the list applied twice; the pool stays far larger than three, so
// the second overlay's draw must be three.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, assertNull } from "../assert";
import { OFFER_COUNT, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const QUEUED: OfferId[] = ["pin"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is consumed by one overlay, and the next draws at random", async () => {
  await isolate(h);
  await h.debug.setNextOffers(QUEUED);
  const first = await openLevelUp(h);
  assertEqual(first.screen, "levelup", "the screen the first level-up opened");
  assertDeepEqual(first.run.offers, QUEUED, "the first overlay's offers");
  assertNull(first.run.nextOffers, "nextOffers once the first overlay opened");

  await h.debug.choose(0);
  const between = await h.snapshot();
  assertEqual(between.screen, "playing", "the screen after the first overlay closed");
  assertNull(between.run.nextOffers, "nextOffers between the overlays");

  const second = await openLevelUp(h);
  await captureStill(h, "consumed");
  assertEqual(second.screen, "levelup", "the screen the second level-up opened");
  assertLength(second.run.offers, OFFER_COUNT, "the second overlay's offers, drawn at random");
  assertNull(second.run.nextOffers, "nextOffers once the second overlay opened");
});
