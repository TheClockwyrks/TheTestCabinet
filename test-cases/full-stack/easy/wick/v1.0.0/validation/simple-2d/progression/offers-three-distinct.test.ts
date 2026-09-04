// progression/offers-three-distinct — an overlay over a pool of at least three
// presents exactly OFFER_COUNT offers, no two alike and every one a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "The overlay offers
// OFFER_COUNT distinct candidates drawn uniformly at random from the pool
// without replacement, using the game's seeded random generator", with
// OFFER_COUNT (3) in the table above it, and "offers holds the drawn ids in the
// order they are listed". specs/instrumentation.md, Snapshot shape, reports
// "offers | the open level-up overlay's offers" against "pool | ... the
// candidate pool of specs/progression.md computed from the slots as they
// stand", so a drawn offer is an id of that pool.
//
// THE POSE. Eight isolated nights, one per seed, each with nothing on the field,
// nothing held, and every driver switch off: the ten base weapons and the ten
// passives are all new-item candidates, so the pool is twenty deep, far past
// OFFER_COUNT. Each seed is laid by reset, and with every faculty held the
// draw is the only thing that reads the generator, so the eight are eight
// independent draws over the same pool. Each overlay is opened the real way, by
// queueing a level-up and running the playing tick that ends with it queued.
//
// THE TOLERANCE. None: the count, the distinctness, and the membership are
// discrete. A build that offers two, or repeats one, or offers an id it cannot
// give fails on the first of the eight it does it on.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { BASE_WEAPON_IDS, OFFER_COUNT, PASSIVE_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/**
 * The candidates a fresh run's pool holds: one per base weapon, Taper's being
 * its `+1 level` offer, and one per passive (specs/progression.md, The pool).
 */
const FRESH_POOL_SIZE = BASE_WEAPON_IDS.length + PASSIVE_IDS.length;

/** Eight seeds, spread across the whole domain reset accepts. */
const SEEDS = [0, 1, 7, 1009, 65535, 999983, 2147483647, 4294967295];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("presents three distinct candidates from every seed over the fresh pool", async () => {
  for (const seed of SEEDS) {
    isolate(h, { seed });

    const overlay = await openLevelUp(h, 1);
    const { offers, pool } = overlay.run;

    assertEqual(
      overlay.screen,
      "levelup",
      `the overlay opened at seed ${seed}`,
    );
    assertEqual(pool.length, FRESH_POOL_SIZE, `the pool at seed ${seed}`);
    assertEqual(offers.length, OFFER_COUNT, `the offers at seed ${seed}`);
    assertEqual(
      new Set(offers).size,
      OFFER_COUNT,
      `the distinct offers at seed ${seed}`,
    );
    for (const offer of offers) {
      assertContains(
        pool,
        offer,
        `an offer of seed ${seed} drawn from the pool`,
      );
    }
  }
  captureStill(h, "offers");
});
