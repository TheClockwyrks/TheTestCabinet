// Meltdown — surge/core-leaks-five-lives: a Core costs five lives.
//
// THE RULE. `specs/surge.md` charges a leak "its leak value in lives", and the
// Core's leak value is `5`, the largest on the roster: "worth five lives if it
// escapes". A run opens on `20` lives at every mode but Sudden Death
// (`specs/modes.md`), so one Core through the exhaust is a quarter of the run.
//
// WHY THE LEAK IS WALKED RATHER THAN POSED. A leak is a TRANSITION, not a field:
// `specs/mazing.md` takes a unit off the floor "when the tile its centre occupies
// is one of the opening tiles of its assigned exhaust", and no operation on the
// surface poses that. So the Core is stood one tile short of the right exhaust —
// `specs/floor.md` gives the left vent the right exhaust as its fixed opposite,
// and its route is recomputed from the tile it is placed on
// (`specs/instrumentation.md`) — and walks the last tile under its own power. The
// event this point reads is therefore the game's own.
//
// WHY THE FLOOR HOLDS NOTHING ELSE. With no tower standing there is no damage path
// at all, so the only way the Core can leave the roster is by reaching its
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
// WHAT EVERY WRONG MODEL READS. A build that charges one life for every leak
// reads a fall of `1`; one that charges the Hulk's `2` reads `2`; one that ends
// the run outright when the boss escapes reads a fall of `20` and a screen that
// is no longer `playing`, which the phase assertion names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilLeaked } from "./scenario";

/**
 * The lives one leaked Core must cost: 5.
 *
 * There is no tolerance on it and there cannot be one — lives are a whole number
 * and `specs/surge.md` fixes the figure exactly — so the assertion is equality.
 */
const COST = SURGE_DEFS.core.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes 5 off the lives when a Core reaches its exhaust", async () => {
  startRun(h);
  poseLeaker(h, "core");

  const before = h.snapshot();
  const leaked = await runUntilLeaked(h);
  captureStill(h, "leak");
  const after = h.snapshot();

  assertTrue(leaked, "precondition: the Core reached its exhaust and left");
  assertLength(
    after.surge,
    0,
    "the units left on the floor after the Core leaked (specs/surge.md)",
  );
  assertEqual(
    before.lives - after.lives,
    COST,
    "the lives one leaked Core cost (specs/surge.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after the leak, which the run stays on while lives remain " +
      "(specs/waves.md)",
  );
});
