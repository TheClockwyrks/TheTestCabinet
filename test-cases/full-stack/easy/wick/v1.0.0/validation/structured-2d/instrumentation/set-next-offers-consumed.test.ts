// Wick — instrumentation/set-next-offers-consumed: after the overlay a
// `setNextOffers` list applied to has opened, `nextOffers` reads null and the
// next level-up overlay draws at random.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setNextOffers(ids)`: "One overlay consumes it, and a later overlay draws at
// random again." `specs/progression.md`, "The draw": `OFFER_COUNT` distinct
// candidates from the pool.
//
// THE DRIVE. An isolated run with two level-ups queued and a list posed; the
// first overlay presents the list and `nextOffers` reads null; `choose(0)`
// opens the second, whose three distinct offers come from the fresh pool with
// `nextOffers` still null.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import { OFFER_COUNT, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const LISTED: OfferId[] = ["pin", "shard", "tinder"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("is consumed by one overlay, the next drawing at random", async () => {
  isolate(h);
  h.debug.setNextOffers(LISTED);
  const first = await openLevelUp(h, 2);
  assertDeepEqual(first.run.offers, LISTED, "the first overlay's offers");
  assertNull(
    first.run.nextOffers,
    "run.nextOffers once the first overlay opened",
  );

  h.debug.choose(0);
  const second = h.snapshot();
  await h.frameDraw();
  captureStill(h, "consumed");
  assertEqual(second.screen, "levelup", "screen on the second overlay");
  assertNull(second.run.nextOffers, "run.nextOffers on the second overlay");
  assertLength(second.run.offers, OFFER_COUNT, "the second overlay's offers");
  assertLength(
    [...new Set(second.run.offers)],
    OFFER_COUNT,
    "distinct second offers",
  );
  for (const offer of second.run.offers) {
    assertContains(
      second.run.pool,
      offer,
      `second offer ${offer} within the pool`,
    );
  }
});
