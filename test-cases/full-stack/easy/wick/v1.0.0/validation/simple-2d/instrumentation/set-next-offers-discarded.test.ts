// instrumentation/set-next-offers-discarded — a list holding an id that is
// not a candidate of the pool when the overlay opens is discarded whole,
// nextOffers reads null, and the overlay draws at random.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setNextOffers`:
// "Otherwise it is discarded whole and the overlay draws at random; an evolved
// weapon's id is never in a pool, so a list naming one is always discarded".
// specs/progression.md, "The draw": OFFER_COUNT distinct candidates from the
// pool.
//
// THE POSE. An isolated run, a list pairing a candidate with `pyre`, which no
// pool holds. The overlay opens with nextOffers null, three distinct offers
// all drawn from the pool, and no `pyre` among them, so the list was not
// presented in part.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertFalse,
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

const LIST: OfferId[] = ["ember", "pyre"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("discards the list and draws from the pool", async () => {
  isolate(h);
  h.debug.setNextOffers(LIST);

  const s = await openLevelUp(h, 1);
  captureStill(h, "discarded");

  assertEqual(s.screen, "levelup", "the overlay opened");
  assertNull(s.run.nextOffers, "nextOffers after the discarded list");
  assertLength(s.run.offers, OFFER_COUNT, "the offers drawn");
  assertEqual(new Set(s.run.offers).size, OFFER_COUNT, "the offers, distinct");
  for (const offer of s.run.offers) {
    assertTrue(
      s.run.pool.includes(offer),
      `offer ${offer} drawn from the pool`,
    );
  }
  assertFalse(s.run.offers.includes("pyre"), "pyre among the offers");
});
