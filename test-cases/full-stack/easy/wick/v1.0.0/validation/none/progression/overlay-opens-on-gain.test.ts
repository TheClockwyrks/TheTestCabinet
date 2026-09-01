// progression/overlay-opens-on-gain — a queued level-up opens the overlay in play.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The level-up
// overlay"): "A `playing` tick that ends with `pendingLevelUps` above `0` runs
// to completion and then opens the overlay: `screen` becomes `levelup` with
// `menuIndex` `0`", and of the draw, "The overlay offers `OFFER_COUNT` distinct
// candidates drawn uniformly at random from the pool" with "`offers` hold[ing]
// the drawn ids in the order they are listed". So a gain that queues a level-up
// leaves the game standing on `levelup` with `offers` filled, and it is standing
// there by the end of the second `playing` tick after the gain whether the build
// opens it on the gain's own tick or on the one after.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// nothing alive, and no slot held, so the pool is every base weapon and every
// passive and the draw has more than `OFFER_COUNT` candidates to make. Level
// `1` with `xp` one short of `XP_BASE` and a small gem at the lamplighter's
// center is the shortest real gain that crosses a threshold; the gem is
// collected by a real tick, and one further frame is run so a build that opens
// the overlay at the start of the next tick is read fairly. This point is about
// the overlay reaching the player at all; the exact tick is
// `progression/overlay-opens-same-tick`'s.
//
// THE TOLERANCE. None: a screen name is exact, and an offer is either drawn
// from the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEachIn, assertEqual, assertGreaterThan } from "../assert";
import { GEM_VALUES, xpToNext } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The level the gain is read from: the first, whose threshold is `XP_BASE`. */
const POSED_LEVEL = 1;

/** One short of that threshold, so one small gem crosses it. */
const POSED_XP = xpToNext(POSED_LEVEL) - GEM_VALUES.small;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands on levelup with offers filled after a gain that queues one", async () => {
  await isolate(h);
  await h.debug.setLevel(POSED_LEVEL);
  await h.debug.setXp(POSED_XP);

  const gained = await collectGem(h, "small");
  assertEqual(
    gained.run.level,
    POSED_LEVEL + 1,
    "the level the gain left, so a level-up was earned",
  );

  const after = await h.step(1);
  await captureStill(h, "opened");

  assertEqual(
    after.screen,
    "levelup",
    "the screen by the end of the second playing tick after the gain",
  );
  assertGreaterThan(
    after.run.offers.length,
    0,
    "the offers the overlay presents",
  );
  assertEachIn(
    after.run.offers,
    after.run.pool,
    "each offer, against the pool",
  );
});
