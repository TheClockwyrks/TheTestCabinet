// progression/offers-whole-small-pool — a pool smaller than OFFER_COUNT is
// offered whole.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The draw"): "every
// candidate in a pool smaller than `OFFER_COUNT` is offered", with `OFFER_COUNT`
// `3`. The offers are still "distinct candidates ... from the pool without
// replacement", so with two candidates the overlay presents exactly those two
// and nothing else.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, over a loadout built so the pool is exactly two: both slot
// kinds full, so no new item is a candidate, and every held item at its own max
// except one weapon one level under `MAX_WEAPON_LEVEL` and one passive one level
// under its own max. Two rather than one, because two is the case where a build
// that pads the draw up to `OFFER_COUNT` has somewhere to pad from, and the pool
// is read off the snapshot alongside the offers so the comparison is against the
// pool the build itself computed as well as against the two ids the pose fixed.
//
// THE TOLERANCE. None: an id is offered or it is not. The order the two are
// listed in is the draw's, so the comparison is over the sorted listings.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  openLevelUp,
  type Harness,
} from "../harness";
import { poseSmallPool, SMALL_POOL_PASSIVE, SMALL_POOL_WEAPON } from "./stage";

/** The two candidates the pose leaves, sorted so the draw's order does not matter. */
const EXPECTED: OfferId[] = [SMALL_POOL_WEAPON, SMALL_POOL_PASSIVE].sort();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("presents both candidates of a two-item pool and nothing else", async () => {
  await poseSmallPool(h);

  const overlay = await openLevelUp(h);
  await captureStill(h, "small");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    [...overlay.run.pool].sort(),
    EXPECTED,
    "the candidate pool the posed loadout leaves",
  );
  assertDeepEqual(
    [...overlay.run.offers].sort(),
    EXPECTED,
    "the offers presented over a pool of two",
  );
});
