// pickups/gem-unattracted-outside — a gem beyond pickupRadius stays put.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Attraction and flight"):
// "a gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted", with `pickupRadius` "`PICKUP_RADIUS` with no Lure held"
// and ("The lamplighter") "| Base pickup radius | `PICKUP_RADIUS` | `48` |";
// and ("Gems") "A gem sits where it was dropped until it is attracted". So a
// gem posed `POSED_DISTANCE` (`49`) units out, one unit past the radius, is
// never attracted and never moves, however long the night runs. That distance
// is the smallest whole number outside the radius, so a build that rounds the
// radius up or tests it loosely fails here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure widens the
// radius, no draft arrives to attract the gem, and nothing else touches it. No
// key is pressed, so the lamplighter holds the origin for the whole span and
// the distance the rule tests stays the posed one. `HELD_TICKS` (`60`) is one
// second of game time; a build that attracts the gem on any tick of that
// second, or nudges it toward the lamplighter, is read at the end.
//
// THE TOLERANCE. None on `attracted`, a boolean. `MOTION_EPS` (`1e-6`) on the
// position it held, the suite's allowance for a position read back across
// ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { MOTION_EPS, PICKUP_RADIUS, REAL_EPS, TICK_HZ } from "../constants";
import {
  advanceTicks,
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

afterEach(() => {
  h.dispose();
});

it("leaves a gem 49 units out unattracted and where it was posed across 60 ticks", async () => {
  const opened = isolate(h);
  assertNear(
    opened.run.pickupRadius,
    PICKUP_RADIUS,
    REAL_EPS,
    "the pickup radius with no Lure held (specs/world.md, The lamplighter)",
  );
  const at = opened.run.player;
  const id = placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  const posed = gemById(h.snapshot(), id);
  assertDefined(posed, "the gem spawnGem placed");

  const after = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "outside");

  const seen = gemById(after, id);
  assertDefined(seen, "the gem after the second");
  assertEqual(
    seen?.attracted,
    false,
    `the attracted flag of a gem ${POSED_DISTANCE} units out, beyond pickupRadius (specs/world.md, Attraction and flight)`,
  );
  assertNear(
    seen?.x ?? NaN,
    posed?.x ?? NaN,
    MOTION_EPS,
    "the gem's x after the second, in units",
  );
  assertNear(
    seen?.y ?? NaN,
    posed?.y ?? NaN,
    MOTION_EPS,
    "the gem's y after the second, in units",
  );
});
