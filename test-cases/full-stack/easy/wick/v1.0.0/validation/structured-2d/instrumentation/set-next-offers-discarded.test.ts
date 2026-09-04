// Wick — instrumentation/set-next-offers-discarded: a list holding an id that
// is not a candidate when the overlay opens is discarded whole, `nextOffers`
// reads null, and the overlay draws at random.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setNextOffers(ids)`: "Otherwise it is discarded whole and the overlay draws
// at random; an evolved weapon's id is never in a pool, so a list naming one
// is always discarded." `specs/progression.md`, "The draw": `OFFER_COUNT`
// distinct candidates from the pool.
//
// THE DRIVE. An isolated run holding nothing, a list with Beacon (evolved,
// never a candidate) between two candidates, and the overlay opened by the
// real tick: `nextOffers` null, three distinct offers each in the pool, and
// the offers not the list.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertLength,
  assertNotDeepEqual,
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

const LISTED: OfferId[] = ["pin", "beacon", "shard"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards the list whole and draws from the pool", async () => {
  isolate(h);
  h.debug.setNextOffers(LISTED);
  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "discarded");

  assertNull(
    overlay.run.nextOffers,
    "run.nextOffers once the list was discarded",
  );
  assertLength(
    overlay.run.offers,
    OFFER_COUNT,
    "offers drawn after the discard",
  );
  assertLength(
    [...new Set(overlay.run.offers)],
    OFFER_COUNT,
    "distinct drawn offers",
  );
  for (const offer of overlay.run.offers) {
    assertContains(
      overlay.run.pool,
      offer,
      `drawn offer ${offer} within the pool`,
    );
  }
  assertNotDeepEqual(
    overlay.run.offers,
    LISTED,
    "offers against the discarded list",
  );
});
