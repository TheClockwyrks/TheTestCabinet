// pickups/gem-unattracted-outside — a gem beyond pickupRadius stays put.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "a
// gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted", with `pickupRadius` "`PICKUP_RADIUS` (`48`) with no Lure
// held", and ("Gems") "A gem sits where it was dropped until it is attracted".
// So a gem posed `POSED_DISTANCE` (`49`) units out, one unit beyond the radius,
// is never attracted and never moves, however long the night runs. The distance
// is the smallest whole number outside the radius, so a build that rounds the
// radius up or tests it loosely fails.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure widens the
// radius, no draft arrives to attract the gem, and nothing else touches it. No
// key is pressed, so the lamplighter holds the origin for the whole span and
// the distance the rule tests stays the posed one. `HELD_TICKS` (`60`) is one
// second of game time; a build that attracts the gem on any tick of it, or
// nudges it toward the lamplighter, is read at the end.
//
// THE TOLERANCE. None on `attracted`, a boolean. `POSITION_TOL` (`1e-6`) on the
// held position, the case's allowance for a position read back across ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, PICKUP_RADIUS, POSITION_TOL, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** One unit beyond `PICKUP_RADIUS` (`48`): the smallest whole distance outside it. */
const POSED_DISTANCE = PICKUP_RADIUS + 1;

/** One second of game time. */
const HELD_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a gem 49 units out unattracted and where it was posed across 60 ticks", async () => {
  const opened = await isolate(h);
  assertNear(
    opened.run.pickupRadius,
    PICKUP_RADIUS,
    FLOAT_TOL,
    "the pickup radius with no Lure held",
  );
  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + POSED_DISTANCE, at.y);

  const after = await h.step(HELD_TICKS);
  await captureStill(h, "outside");

  const seen = gemById(after, gem.id);
  assertDefined(seen, "the gem after the second");
  assertEqual(
    seen!.attracted,
    false,
    "the attracted flag of a gem beyond pickupRadius",
  );
  assertNear(seen!.x, gem.x, POSITION_TOL, "the gem's x after the second");
  assertNear(seen!.y, gem.y, POSITION_TOL, "the gem's y after the second");
});
