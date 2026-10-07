// progression/offers-drawn-at-random — the offers are drawn at random.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The draw"): "The
// overlay offers `OFFER_COUNT` distinct candidates DRAWN UNIFORMLY AT RANDOM
// from the pool without replacement", and "`offers` holds the drawn ids in the
// order they are listed". The pool "is computed each time a level-up overlay
// opens, from the slots as they stand at that moment", so ten overlays opened
// over unchanged slots draw from one and the same pool, and ten draws cannot
// all present the same three ids in the same order.
//
// WHY THE WORLD IS POSED AS IT IS. One isolated night, every faculty held and
// nothing alive, with no slot held, so the pool is all twenty candidates every
// time. Each overlay is opened the real way, a queued level-up and the tick
// that opens it, and left through `setScreen("playing")`, which "Sets `screen`
// to `name` ... Nothing else changes", so the slots stand and no offer is
// accepted between draws. Ten rather than two, because two draws from a pool
// of twenty coincide often enough to be worth nothing; ten listings that are
// all identical mean the pool was not drawn from at all. Nothing is posed for
// the draw itself.
//
// THE TOLERANCE. The check is that the ten listings are not all one, which is
// the weakest claim that distinguishes a draw from a fixed answer: a build that
// draws uniformly fails this only if ten independent draws from a pool of
// twenty all land on the same ordered three, which is a chance of about one in
// ten to the thirty-two.

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
  poseScreen,
  type Harness,
} from "../harness";

/** How many overlays the same pool is drawn over. */
const OVERLAYS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not present one listing across ten overlays over the same pool", async () => {
  await isolate(h);
  const listings: string[] = [];
  let poolSize = 0;
  for (let draw = 1; draw <= OVERLAYS; draw += 1) {
    const overlay = await openLevelUp(h);
    assertEqual(
      overlay.screen,
      "levelup",
      `the screen the queued level-up opened on draw ${draw}`,
    );
    assertLength(
      overlay.run.offers,
      OFFER_COUNT,
      `the offers drawn on draw ${draw}`,
    );
    assertEachIn(
      overlay.run.offers,
      overlay.run.pool,
      `each offer against the pool on draw ${draw}`,
    );
    if (poolSize === 0) poolSize = overlay.run.pool.length;
    assertEqual(
      overlay.run.pool.length,
      poolSize,
      `the pool the draw was made from on draw ${draw}`,
    );
    listings.push(overlay.run.offers.join(" "));
    if (draw === OVERLAYS) await captureStill(h, "random");
    await poseScreen(h, "playing");
  }

  assertGreaterThan(
    new Set(listings).size,
    1,
    "the distinct listings across ten overlays over the same pool",
  );
});
