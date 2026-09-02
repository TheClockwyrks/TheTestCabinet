// Meltdown — surge/hulk-leaks-two-lives: a Hulk costs two lives.
//
// THE RULE. `specs/surge.md` charges a leak "its leak value in lives", and the
// Hulk's leak value is `2` — one of only two rows on the roster that is not `1`.
// So this point is not about leaking at all, which `surge/leak-costs-a-life`
// decides on a Mote: it is about the leak being read out of the TABLE rather than
// assumed to be one life for everything.
//
// WHY THE LEAK IS WALKED RATHER THAN POSED. A leak is a TRANSITION, not a field:
// `specs/mazing.md` takes a unit off the floor "when the tile its centre occupies
// is one of the opening tiles of its assigned exhaust", and no operation on the
// surface poses that. So the Hulk is stood one tile short of the right exhaust —
// `specs/floor.md` gives the left vent the right exhaust as its fixed opposite,
// and its route is recomputed from the tile it is placed on
// (`specs/instrumentation.md`) — and walks the last tile under its own power. The
// event this point reads is therefore the game's own.
//
// WHY THE FLOOR HOLDS NOTHING ELSE. With no tower standing there is no damage path
// at all, so the only way the Hulk can leave the roster is by reaching its
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
// reads a fall of `1` — the single most likely defect here, and the one this
// point exists for; one that charges five, the Core's figure, reads `5`; one that
// derived the cost from the hp reads something far larger.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, runUntilLeaked } from "./scenario";

/**
 * The lives one leaked Hulk must cost: 2.
 *
 * There is no tolerance on it and there cannot be one — lives are a whole number
 * and `specs/surge.md` fixes the figure exactly — so the assertion is equality.
 */
const COST = SURGE_DEFS.hulk.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes 2 off the lives when a Hulk reaches its exhaust", async () => {
  startRun(h);
  poseLeaker(h, "hulk");

  const before = h.snapshot();
  const leaked = await runUntilLeaked(h);
  captureStill(h, "leak");
  const after = h.snapshot();

  assertTrue(leaked, "precondition: the Hulk reached its exhaust and left");
  assertLength(
    after.surge,
    0,
    "the units left on the floor after the Hulk leaked (specs/surge.md)",
  );
  assertEqual(
    before.lives - after.lives,
    COST,
    "the lives one leaked Hulk cost (specs/surge.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after the leak, which the run stays on while lives remain " +
      "(specs/waves.md)",
  );
});
