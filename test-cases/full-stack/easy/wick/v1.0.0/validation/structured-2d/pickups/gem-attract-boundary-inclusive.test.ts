// pickups/gem-attract-boundary-inclusive — a gem at exactly pickupRadius
// becomes attracted.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Attraction and flight"):
// "a gem whose center is at most `pickupRadius` from the lamplighter's center
// becomes attracted". "At most" makes the boundary inclusive, and ("The
// lamplighter") fixes "| Base pickup radius | `PICKUP_RADIUS` | `48` |", with
// `pickupRadius` "`PICKUP_RADIUS` with no Lure held". So a gem posed exactly
// `PICKUP_RADIUS` units out reads `attracted` `true` after the next tick, and a
// build that tests the distance strictly leaves it `false`. This is the edge of
// the rule `pickups/gem-attracted-inside` reads inside and
// `pickups/gem-unattracted-outside` reads outside, so it stands on its own.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure moves the
// boundary and nothing else touches the gem. The gem is posed along `+x` from
// the lamplighter's center, so the distance the rule tests is one subtraction
// of two exactly representable numbers and lands on `48` exactly rather than on
// a square root that rounds. It takes its flight step on the same tick, landing
// at `38`, still well beyond `COLLECT_RADIUS` (`8`), so it is on the field to be
// read.
//
// THE TOLERANCE. None on `attracted`, a boolean; the boundary itself is exact,
// which is what makes it readable at all. The run's own `pickupRadius` is read
// against `PICKUP_RADIUS` within `REAL_EPS` first, so a build whose radius is
// not the base figure fails on that rather than on the boundary rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { PICKUP_RADIUS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads attracted true after the next tick for a gem exactly 48 units out", async () => {
  const opened = isolate(h);
  assertNear(
    opened.run.pickupRadius,
    PICKUP_RADIUS,
    REAL_EPS,
    "the pickup radius with no Lure held (specs/world.md, The lamplighter)",
  );
  const at = opened.run.player;
  const id = placeGem(h, "small", at.x + PICKUP_RADIUS, at.y);
  assertEqual(
    gemById(h.snapshot(), id)?.attracted,
    false,
    "the posed gem's attracted flag",
  );

  const after = await advanceTicks(h, 1);
  captureStill(h, "boundary");

  const seen = gemById(after, id);
  assertDefined(seen, "the gem after the tick");
  assertEqual(
    seen?.attracted,
    true,
    `the attracted flag of a gem exactly ${PICKUP_RADIUS} units out, the inclusive boundary (specs/world.md, Attraction and flight)`,
  );
});
