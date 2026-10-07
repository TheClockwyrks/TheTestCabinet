// progression/offers-three-distinct — an overlay over a pool of at least three
// presents exactly OFFER_COUNT offers, no two alike and every one a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "The overlay offers
// OFFER_COUNT distinct candidates drawn uniformly at random from the pool
// without replacement", with
// OFFER_COUNT (3) in the table above it, and "offers holds the drawn ids in the
// order they are listed". specs/instrumentation.md, Snapshot shape, reports
// "offers | the open level-up overlay's offers" against "pool | ... the
// candidate pool of specs/progression.md computed from the slots as they
// stand", so a drawn offer is an id of that pool.
//
// THE POSE. One isolated night with nothing on the field, nothing held, and
// every driver switch off: the ten base weapons and the ten passives are all
// new-item candidates, so the pool is twenty deep, far past OFFER_COUNT. Eight
// overlays are opened in turn, each the real way, by queueing a level-up and
// running the playing tick that ends with it queued, and each left through
// `setScreen("playing")`, which "Sets `screen` to `name` ... Nothing else
// changes", so the slots stand and the eight are eight independent draws over
// the same pool.
//
// THE TOLERANCE. None: the count, the distinctness, and the membership are
// discrete. A build that offers two, or repeats one, or offers an id it cannot
// give fails on the first of the eight draws it does it on.

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

/** How many draws are read over the fresh pool. */
const DRAWS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("presents three distinct candidates on every draw over the fresh pool", async () => {
  isolate(h);
  for (let draw = 1; draw <= DRAWS; draw += 1) {
    const overlay = await openLevelUp(h, 1);
    const { offers, pool } = overlay.run;

    assertEqual(
      overlay.screen,
      "levelup",
      `the overlay opened on draw ${draw}`,
    );
    assertEqual(pool.length, FRESH_POOL_SIZE, `the pool on draw ${draw}`);
    assertEqual(offers.length, OFFER_COUNT, `the offers on draw ${draw}`);
    assertEqual(
      new Set(offers).size,
      OFFER_COUNT,
      `the distinct offers on draw ${draw}`,
    );
    for (const offer of offers) {
      assertContains(
        pool,
        offer,
        `an offer of draw ${draw} drawn from the pool`,
      );
    }
    if (draw === DRAWS) captureStill(h, "offers");
    h.debug.setScreen("playing");
  }
});
