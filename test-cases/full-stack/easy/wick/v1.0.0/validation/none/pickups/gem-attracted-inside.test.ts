// pickups/gem-attracted-inside — a gem inside pickupRadius becomes attracted.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "On
// every tick, a gem whose center is at most `pickupRadius` from the
// lamplighter's center becomes attracted ... `pickupRadius` is `PICKUP_RADIUS`
// times the pickup multiplier `specs/passives.md` defines, so it is
// `PICKUP_RADIUS` with no Lure held", and "The lamplighter" fixes
// "Base pickup radius | `PICKUP_RADIUS` | `48`". So with no Lure held a gem
// `POSED_DISTANCE` (`40`) units out is inside the radius and reads `attracted`
// `true` after the next tick. The gem also takes its flight step on that tick
// (it "existed before this tick"), landing `GEM_STEP` (`10`) units closer at
// `30`, which is still beyond `COLLECT_RADIUS` (`8`), so the gem is on the
// field to be read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure widens the
// radius and nothing else touches the gem. The gem is placed by `spawnGem`,
// which "Places one unattracted gem" (specs/instrumentation.md), so the
// `attracted` this check reads is the one the tick set. The lamplighter is left
// at the origin and no key is pressed, so the distance the tick tests is the
// posed one.
//
// THE TOLERANCE. None on `attracted`, a boolean. The posed distance is checked
// against the run's own `pickupRadius` within `FLOAT_TOL` first, so a build
// whose radius is not the base figure fails on that rather than on the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertDefined, assertNear } from "../assert";
import { FLOAT_TOL, PICKUP_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** Inside `PICKUP_RADIUS` (`48`) by eight units, and far enough out to survive its first flight step. */
const POSED_DISTANCE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads attracted true after the next tick for a gem 40 units out", async () => {
  const opened = await isolate(h);
  assertNear(
    opened.run.pickupRadius,
    PICKUP_RADIUS,
    FLOAT_TOL,
    "the pickup radius with no Lure held",
  );
  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  assertEqual(gem.attracted, false, "the posed gem's attracted flag");

  const after = await h.step(1);
  await captureStill(h, "attracted");

  const seen = gemById(after, gem.id);
  assertDefined(seen, "the gem after the tick");
  assertEqual(seen!.attracted, true, "the gem's attracted flag after the tick");
});
