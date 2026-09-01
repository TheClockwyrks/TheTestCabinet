// instrumentation/set-next-offers-consumed — after the overlay a
// setNextOffers list applied to has opened, nextOffers reads null and the
// next level-up overlay draws at random.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setNextOffers`:
// "One overlay consumes it, and a later overlay draws at random again";
// specs/state.md, `nextOffers`: "Opening an overlay consumes it".
//
// THE POSE. An isolated run, a posed list, two level-ups queued. The first
// overlay presents the list and nextOffers reads null; `choose(0)` opens the
// second, which holds OFFER_COUNT distinct offers all drawn from its pool.
// What a random draw looks like beyond that is not a thing a check can fix,
// so the second overlay is read as a lawful draw rather than as any list.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
  assertTrue,
} from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import type { OfferId } from "../surface";

const LIST: OfferId[] = ["ember", "pin", "wick"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("consumes the list on the first overlay and draws on the next", async () => {
  isolate(h);
  h.debug.setNextOffers(LIST);
  const first = await openLevelUp(h, 2);
  assertDeepEqual(first.run.offers, LIST, "the first overlay's offers");
  assertNull(first.run.nextOffers, "nextOffers once the first overlay opened");

  h.debug.choose(0);
  const second = h.snapshot();
  await h.tick(1);
  captureStill(h, "consumed");

  assertEqual(second.screen, "levelup", "the second overlay opened");
  assertNull(second.run.nextOffers, "nextOffers on the second overlay");
  assertLength(second.run.offers, OFFER_COUNT, "the second overlay's offers");
  assertEqual(
    new Set(second.run.offers).size,
    OFFER_COUNT,
    "the offers, distinct",
  );
  for (const offer of second.run.offers) {
    assertTrue(
      second.run.pool.includes(offer),
      `offer ${offer} drawn from the pool`,
    );
  }
});
