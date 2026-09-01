// progression/offers-vary-with-seed — the offers are drawn at random.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The draw"): "The
// overlay offers `OFFER_COUNT` distinct candidates DRAWN UNIFORMLY AT RANDOM
// from the pool without replacement, USING THE GAME'S SEEDED RANDOM GENERATOR",
// and "`offers` holds the drawn ids in the order they are listed".
// specs/instrumentation.md fixes the seed as the thing that decides a session:
// `reset(options)` "reseeds", and a run from a known seed is that reset followed
// by the transition into play. So ten runs that differ only in their seed, over
// one and the same pool, cannot all present the same three ids in the same
// order.
//
// WHY THE WORLD IS POSED AS IT IS. Ten isolated nights, every faculty held and
// nothing alive, differing in nothing but the seed the reset is given, so the
// pool is the same twenty candidates every time and the draw is the only thing
// that can differ. Ten rather than two, because two draws from a pool of twenty
// coincide often enough to be worth nothing; ten distinct listings that are all
// identical mean the pool was not drawn from at all.
//
// THE TOLERANCE. The check is that the ten listings are not all one, which is
// the weakest claim that distinguishes a draw from a fixed answer: a build whose
// generator is seeded and uniform fails this only if ten independent draws from
// a pool of twenty all land on the same ordered three, which is a chance of
// about one in ten to the thirty-two.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEachIn,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The ten seeds the same pool is drawn over. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not present one listing across ten seeds over the same pool", async () => {
  const listings: string[] = [];
  let poolSize = 0;
  for (const seed of SEEDS) {
    await isolate(h, { seed });
    const overlay = await openLevelUp(h);
    assertEqual(
      overlay.screen,
      "levelup",
      `the screen the queued level-up opened at seed ${seed}`,
    );
    assertLength(
      overlay.run.offers,
      OFFER_COUNT,
      `the offers drawn at seed ${seed}`,
    );
    assertEachIn(
      overlay.run.offers,
      overlay.run.pool,
      `each offer against the pool at seed ${seed}`,
    );
    if (poolSize === 0) poolSize = overlay.run.pool.length;
    assertEqual(
      overlay.run.pool.length,
      poolSize,
      `the pool the draw was made from at seed ${seed}`,
    );
    listings.push(overlay.run.offers.join(" "));
  }
  await captureStill(h, "random");

  assertGreaterThan(
    new Set(listings).size,
    1,
    "the distinct listings across ten seeds over the same pool",
  );
});
