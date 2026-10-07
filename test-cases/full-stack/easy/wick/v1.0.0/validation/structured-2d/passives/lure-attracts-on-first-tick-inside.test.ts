// passives/lure-attracts-on-first-tick-inside — a gem outside the base radius
// is attracted on the first tick Lure brings it inside.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Pickup radius: "The
// radius within which a gem becomes attracted is `PICKUP_RADIUS` (`48`) times
// `pickupMul` ... The attraction rule in `specs/world.md` reads this radius on
// every tick, so a gem that was outside the base radius is picked up on the
// first tick Lure brings it inside." `pickupMul` is `1 + 0.25 × lure`, so the
// radius is `48` with no Lure held and `60` at Lure 1. A gem `55` units out is
// outside the first and inside the second.
//
// WHY THE FIRST SPAN IS A SECOND LONG. Sixty ticks with no Lure held, over
// which the gem must stay unattracted and stay where it was placed: a build
// that attracted on placement, or that widened the radius for a passive it
// does not hold, fails there rather than at the end.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no passive, with
// one unattracted gem placed fifty-five units out through `spawnGem`, which
// "places one unattracted gem" (`specs/instrumentation.md`). Lure 1 is placed
// after that span and one further tick is run, which is the tick the rule
// reads the new radius on. Every driver switch is off, so nothing else drops a
// gem or moves the lamplighter, and the gem's distance is fixed by the pose
// alone.
//
// THE TOLERANCE. The gem's `attracted` flag is a boolean, compared exactly,
// and `MOTION_EPS` on its position across the first span, which nothing moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertPointNear } from "../assert";
import {
  MOTION_EPS,
  PICKUP_RADIUS,
  TICK_HZ,
  pickupRadiusOf,
} from "../constants";
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

/** The Lure level gained: `pickupRadius` `60`. */
const LURE = 1;

/** Where the gem sits: outside `48` and inside the `60` Lure 1 gives. */
const DISTANCE = 55;

/** One second of game time with no Lure held. */
const BEFORE_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a gem 55 units out unattracted with no Lure and attracts it the tick after Lure 1 is held", async () => {
  if (!(DISTANCE > PICKUP_RADIUS && DISTANCE < pickupRadiusOf(LURE))) {
    throw new Error("the gem must sit between the base and the Lure 1 radius");
  }

  const start = isolate(h);
  const at = { x: start.run.player.x + DISTANCE, y: start.run.player.y };
  const gem = placeGem(h, "small", at.x, at.y);

  const waited = await advanceTicks(h, BEFORE_TICKS);
  assertEqual(
    gemById(waited, gem)?.attracted,
    false,
    "the gem's attracted flag after a second with no Lure held (specs/world.md, Attraction and flight)",
  );
  assertPointNear(
    gemById(waited, gem) ?? { x: NaN, y: NaN },
    at,
    MOTION_EPS,
    "the unattracted gem's position after a second (specs/world.md, Attraction and flight)",
  );

  holdPassive(h, "lure", LURE);
  const attracted = await advanceTicks(h, 1);
  captureStill(h, "inside");
  assertEqual(
    gemById(attracted, gem)?.attracted,
    true,
    "the gem's attracted flag on the first tick after Lure 1 was held (specs/passives.md, Pickup radius)",
  );
});
