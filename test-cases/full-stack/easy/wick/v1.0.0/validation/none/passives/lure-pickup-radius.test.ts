// Wick — passives/lure-pickup-radius: Lure multiplies the pickup radius by
// `1 + 0.25` per level, and a gem inside the widened radius is attracted.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure`" with `LURE_PICKUP_PER_LEVEL`
// (`0.25`), and ("Pickup radius") "The radius within which a gem becomes
// attracted is `PICKUP_RADIUS` (`48`) times `pickupMul`, measured from the
// lamplighter's center to the gem's." So at Lure 2 the radius is `72`, which
// `specs/instrumentation.md` ("Snapshot shape") reports by the same formula.
// `specs/world.md` ("Attraction and flight"): "On every tick, a gem whose
// center is at most `pickupRadius` from the lamplighter's center becomes
// attracted", so a gem `GEM` (`70`) units out, outside the base `48` and inside
// the widened `72`, is attracted on the next tick.
//
// THE POSE. An isolated night with Lure 2 held through `setPassive` and one
// small gem posed `70` units along `+x` through `spawnGem`, which places it
// "unattracted". One tick then runs. Every faculty stays held, the lamplighter
// stands at the origin, and nothing else is on the field, so the only rule that
// could set `attracted` is the radius the tick read.
//
// TOLERANCE. `FLOAT_TOL` on the reported radius, an exact product; whether the
// gem is attracted is exact. A build reading the base `48` leaves it
// unattracted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, pickupRadiusOf } from "../constants";
import {
  captureStill,
  createHarness,
  gemById,
  holdPassive,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** The Lure level held: `pickupRadius` `72`. */
const LURE_LEVEL = 2;

/** How far along `+x` the gem is posed: outside 48, inside 72. */
const GEM = 70;

/** `48 × (1 + 0.25 × 2)`. */
const EXPECTED_RADIUS = pickupRadiusOf({ lure: LURE_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads pickupRadius 72 with Lure 2 held and attracts a gem 70 units out", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "lure", LURE_LEVEL);
  const posed = await h.snapshot();
  assertNear(
    posed.run.pickupRadius,
    EXPECTED_RADIUS,
    FLOAT_TOL,
    "the pickupRadius reported with Lure 2 held",
  );

  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + GEM, at.y);
  assertEqual(gem.attracted, false, "the gem's attracted flag as posed");

  const next = await h.step(1);
  await captureStill(h, "radius");

  assertEqual(
    gemById(next, gem.id)?.attracted,
    true,
    `the attracted flag of a gem ${GEM} units out with Lure 2 held`,
  );
});
