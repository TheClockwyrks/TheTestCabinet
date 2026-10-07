// pickups/gem-attracted-inside — a gem within pickupRadius becomes attracted.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Attraction and flight"):
// "On every tick, a gem whose center is at most `pickupRadius` from the
// lamplighter's center becomes attracted ... `pickupRadius` is `PICKUP_RADIUS`
// times the pickup multiplier `specs/passives.md` defines, so it is
// `PICKUP_RADIUS` with no Lure held", and ("The lamplighter") tabulates
// "| Base pickup radius | `PICKUP_RADIUS` | `48` |". So with no Lure held a gem
// posed `POSED_DISTANCE` (`40`) units out is inside the radius and reads
// `attracted` `true` after the next tick. The gem also takes its flight step on
// that tick, since it "existed before this tick" (phase 9 of "One tick"),
// landing `GEM_STEP` (`10`) units closer at `30`, still well beyond
// `COLLECT_RADIUS` (`8`), so it is on the field to be read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure widens the
// radius, no draft attracts the gem from elsewhere, and nothing else touches
// it. The gem is placed with `spawnGem`, which "Places one unattracted gem"
// (`specs/instrumentation.md`), so the flag read after the tick is the one the
// tick set rather than one the pose left. It is posed along `+x`, so the
// distance the rule tests is one subtraction of two exact numbers rather than a
// square root that rounds. No key is pressed, so the lamplighter holds the
// origin and the distance stays the posed one.
//
// THE TOLERANCE. None on `attracted`, a boolean. The run's own `pickupRadius`
// is read against `PICKUP_RADIUS` within `REAL_EPS` first, so a build whose
// radius is not the base figure fails on that rather than on this rule.

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

/** Inside `PICKUP_RADIUS` (`48`) by eight units, and far enough out to survive its first flight step. */
const POSED_DISTANCE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads attracted true after the next tick for a gem 40 units out", async () => {
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
  assertEqual(posed?.attracted, false, "the posed gem's attracted flag");

  const after = await advanceTicks(h, 1);
  captureStill(h, "attracted");

  const seen = gemById(after, id);
  assertDefined(seen, "the gem after the tick");
  assertEqual(
    seen?.attracted,
    true,
    `the attracted flag of a gem ${POSED_DISTANCE} units out, inside pickupRadius (specs/world.md, Attraction and flight)`,
  );
});
