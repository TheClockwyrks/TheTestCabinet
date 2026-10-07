// passives/lure-pickup-radius — Lure multiplies the pickup radius by
// `1 + LURE_PICKUP_PER_LEVEL` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `LURE_PICKUP_PER_LEVEL` is `0.25`, and
// "pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure", so Lure 2 is `1.5`. The
// Pickup radius section applies it: "The radius within which a gem becomes
// attracted is `PICKUP_RADIUS` (`48`) times `pickupMul`, measured from the
// lamplighter's center to the gem's", so `pickupRadius` reads `72`.
// `specs/world.md` (Attraction and flight) is where that radius acts: "a gem
// whose center is at most `pickupRadius` from the lamplighter's center becomes
// attracted".
//
// WHY THE GEM STANDS AT SEVENTY. Inside the scaled `72` and outside the
// unscaled `48`, so the reading separates a build that applied Lure from one
// that did not. `GEM_SPEED` is `600`, a flight step of `10` units a tick, so
// after the one tick that attracts it the gem is at `60`, still well outside
// `COLLECT_RADIUS` (`8`) and still in the world to be read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Lure 2 alone, with
// one unattracted gem placed seventy units out through `spawnGem`, which
// "places one unattracted gem" (`specs/instrumentation.md`). Every driver
// switch is off, so nothing else drops a gem or moves the lamplighter.
//
// THE TOLERANCE. `REAL_EPS` on `pickupRadius`, one constant times one
// multiplier; the gem's `attracted` flag is a boolean, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import { PICKUP_RADIUS, REAL_EPS, pickupRadiusOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  gemById,
  holdPassive,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** The Lure level held: `pickupMul` `1.5`. */
const LURE = 2;

/** The radius `PICKUP_RADIUS` becomes under Lure 2: `72`. */
const RADIUS = pickupRadiusOf(LURE);

/** Where the gem sits: inside `72` and outside the unscaled `48`. */
const DISTANCE = 70;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads pickupRadius 72 under Lure 2 and attracts a gem 70 units out", async () => {
  isolate(h);
  holdPassive(h, "lure", LURE);
  const held = h.snapshot();
  assertNear(
    held.run.pickupRadius,
    RADIUS,
    REAL_EPS,
    "run.pickupRadius under Lure 2 (specs/passives.md, Pickup radius)",
  );

  const { player } = held.run;
  const gem = placeGem(h, "small", player.x + DISTANCE, player.y);
  assertEqual(
    gemById(h.snapshot(), gem)?.attracted,
    false,
    "the gem's attracted flag as placed (specs/instrumentation.md, spawnGem)",
  );
  assertTrue(
    DISTANCE > PICKUP_RADIUS,
    "the gem stands outside the unscaled pickup radius",
  );

  const attracted = await advanceTicks(h, 1);
  captureStill(h, "radius");
  assertEqual(
    gemById(attracted, gem)?.attracted,
    true,
    "the gem's attracted flag after one tick under Lure 2 (specs/world.md, Attraction and flight)",
  );
});
