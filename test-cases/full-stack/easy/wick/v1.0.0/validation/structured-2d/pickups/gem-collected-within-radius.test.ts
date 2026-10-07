// pickups/gem-collected-within-radius — a gem within COLLECT_RADIUS after its
// move is collected, and one outside it is not.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Attraction and flight"):
// "After it moves, a gem whose center is at most `COLLECT_RADIUS` from the
// lamplighter's center is collected on that tick: it is removed, and `xp` rises
// by `GEM_VALUES[tier] × xpMul`", with "| Collection distance |
// `COLLECT_RADIUS` | `8` |" and one tick's flight `GEM_STEP` (`10`) units. So a
// gem posed `INSIDE_START` (`17`) units out ends its move `7` units from the
// center, at most `COLLECT_RADIUS`, and is removed on that tick with `xp` up by
// its tier's value; a gem posed `OUTSIDE_START` (`19`) units out ends `9` units
// from the center, beyond it, and is left lying there. Both sides of the one
// boundary are read here because they are the one rule, and a build that
// collects at the wrong distance misses exactly one of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Soot scales the
// gain and nothing else removes a gem. The two gems are posed on opposite sides
// of the lamplighter, `+x` and `−x`, so neither stands on the other's flight
// line and one tick reads both sides of the boundary in one world. Both are
// latched with `setGemAttracted`, so each takes its flight step on that tick and
// the reading is about the collection test rather than about the radius that
// starts a flight. Both are `small`, so the experience gained names which one
// was taken: exactly `GEM_VALUES.small` (`1`).
//
// THE TOLERANCE. `MOTION_EPS` (`1e-6`) on where the uncollected gem came to
// rest, a position integrated over one tick, and `REAL_EPS` on the experience,
// "a real number"; the removals themselves are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear, assertUndefined } from "../assert";
import {
  COLLECT_RADIUS,
  GEM_SPEED,
  GEM_VALUES,
  MOTION_EPS,
  REAL_EPS,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** One tick's flight: `GEM_SPEED × TICK_DT` = `10` units. */
const GEM_STEP = GEM_SPEED * TICK_DT;

/** Posed so the tick's step ends the gem `7` units out, inside `COLLECT_RADIUS` (`8`). */
const INSIDE_START = GEM_STEP + COLLECT_RADIUS - 1;

/** Posed so the tick's step ends the gem `9` units out, beyond `COLLECT_RADIUS`. */
const OUTSIDE_START = GEM_STEP + COLLECT_RADIUS + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("collects the gem that ends 7 units out and leaves the one that ends 9", async () => {
  const opened = isolate(h);
  const at = opened.run.player;
  const inside = placeGem(h, "small", at.x + INSIDE_START, at.y);
  const outside = placeGem(h, "small", at.x - OUTSIDE_START, at.y);
  h.debug.setGemAttracted(inside, true);
  h.debug.setGemAttracted(outside, true);

  const after = await advanceTicks(h, 1);
  captureStill(h, "collected");

  assertUndefined(
    gemById(after, inside),
    `the gem that ended ${COLLECT_RADIUS - 1} units out (specs/world.md, Attraction and flight)`,
  );
  assertNear(
    after.run.xp - opened.run.xp,
    GEM_VALUES.small,
    REAL_EPS,
    "the experience the collected gem granted",
  );
  const left = gemById(after, outside);
  assertDefined(left, `the gem that ended ${COLLECT_RADIUS + 1} units out`);
  assertNear(
    distance({ x: left?.x ?? NaN, y: left?.y ?? NaN }, after.run.player),
    COLLECT_RADIUS + 1,
    MOTION_EPS,
    "the uncollected gem's distance from the lamplighter, in units",
  );
});
