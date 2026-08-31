// Meltdown — surge/leak-costs-a-life: a leak costs a life.
//
// THE RULE. `specs/surge.md` removes a unit "on the frame" it "reached its
// assigned exhaust", and what that costs is "Its leak value in lives". The Mote's
// leak value is `1`, so the whole of this point is one life off the count and one
// unit off the roster.
//
// WHY THE LEAK IS WALKED RATHER THAN POSED. A leak is a TRANSITION, not a field:
// `specs/mazing.md` takes a unit off the floor "when the tile its centre occupies
// is one of the opening tiles of its assigned exhaust", and no operation on the
// surface poses that. So the Mote is stood one tile short of the right exhaust —
// `specs/floor.md` gives the left vent the right exhaust as its fixed opposite,
// and its route is recomputed from the tile it is placed on
// (`specs/instrumentation.md`) — and walks the last tile under its own power. The
// event this point reads is therefore the game's own.
//
// WHY THE FLOOR HOLDS NOTHING ELSE. With no tower standing there is no damage path
// at all, so the only way the Mote can leave the roster is by reaching its
// exhaust, and the fall in the lives is a fall this one leak paid for. Nothing
// else on the floor can leak alongside it, so the reading is one unit's leak
// value and not a sum.
//
// WHY THE PHASE IS `building`. A wave clears only while the phase is `wave`
// (`specs/waves.md`), and a clear moves the money, the score and the wave number.
// In a build phase the leak costs what a leak costs and nothing else happens, and
// the run stays on the `playing` screen — which is asserted, because
// `specs/waves.md` ends the run "at once" when the lives reach `0` and a build
// that charged far too much would end it here instead of reading a wrong figure.
//
// WHAT EVERY WRONG MODEL READS. A build that charges nothing for a leak reads a
// fall of `0`; one that charges a life per unit of hp, or per wave, reads far
// more; one that removes the life but leaves the unit walking through the wall
// fails on the roster; one that removes the unit at the exhaust without charging
// anything reads `0` with an empty roster, which is the defect this point exists
// to catch.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../../src/constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilLeaked } from "./scenario";

/**
 * The lives one leaked Mote must cost: 1.
 *
 * There is no tolerance on it and there cannot be one — lives are a whole number
 * and `specs/surge.md` fixes the figure exactly — so the assertion is equality.
 */
const COST = SURGE_DEFS.mote.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes 1 off the lives when a Mote reaches its exhaust", async () => {
  startRun(h);
  poseLeaker(h, "mote");

  const before = h.snapshot();
  const leaked = await runUntilLeaked(h);
  captureStill(h, "leak");
  const after = h.snapshot();

  assertTrue(leaked, "precondition: the Mote reached its exhaust and left");
  assertLength(
    after.surge,
    0,
    "the units left on the floor after the Mote leaked (specs/surge.md)",
  );
  assertEqual(
    before.lives - after.lives,
    COST,
    "the lives one leaked Mote cost (specs/surge.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after the leak, which the run stays on while lives remain " +
      "(specs/waves.md)",
  );
});
