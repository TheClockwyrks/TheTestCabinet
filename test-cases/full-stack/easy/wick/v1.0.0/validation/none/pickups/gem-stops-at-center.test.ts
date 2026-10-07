// pickups/gem-stops-at-center — an attracted gem stops at the lamplighter's
// center rather than flying past it.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "An
// attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT`, stopping at the center rather than passing it. After it
// moves, a gem whose center is at most `COLLECT_RADIUS` from the lamplighter's
// center is collected on that tick", with `GEM_STEP` (`10`) the tick's step and
// `COLLECT_RADIUS` (`8`) the collection distance.
//
// WHAT MAKES THE CLAMP READABLE, AND WHY THE DISTANCE IS THIS ONE. A gem that
// stops lands on the center, at distance `0`; one that takes the whole step
// lands `GEM_STEP − d` past the center from `d` units out. Both are removed on
// that tick whenever the overshoot is at most `COLLECT_RADIUS`, so the two
// designs are indistinguishable from every distance the game reports, and the
// clamp is only observable where the overshoot escapes the collection distance:
// `GEM_STEP − d > COLLECT_RADIUS`, that is `d < 2`. So the gem is posed
// `POSED_DISTANCE` (`1`) unit out. A build that stops at the center collects it
// on that tick; a build that passes the center leaves it `9` units out, beyond
// `COLLECT_RADIUS`, still on the field. Removal on the tick is therefore the
// reading, and it is the clamp that decides it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so nothing else can
// remove the gem and no Lure or draft is involved. The gem is latched with
// `setGemAttracted`, so the tick's phase 9 is a flight step and a collection
// test and nothing else. No key is pressed, so the lamplighter holds the origin
// and the whole step lies along one axis.
//
// THE TOLERANCE. None: the gem is on the field after the tick or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { COLLECT_RADIUS, GEM_STEP } from "../constants";
import {
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/**
 * One unit out: close enough that a whole-step flight would land the gem
 * `GEM_STEP − 1` (`9`) units past the center, outside `COLLECT_RADIUS` (`8`).
 */
const POSED_DISTANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands a gem one unit out on the center, so the tick collects it", async () => {
  assertEqual(
    GEM_STEP - POSED_DISTANCE > COLLECT_RADIUS,
    true,
    "that an unclamped step from the posed distance clears COLLECT_RADIUS",
  );
  const opened = await isolate(h);
  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  await h.debug.setGemAttracted(gem.id, true);

  const after = await h.step(1);
  await captureStill(h, "stopped");

  assertUndefined(
    gemById(after, gem.id),
    "the gem after the tick that flew it onto the lamplighter's center",
  );
});
