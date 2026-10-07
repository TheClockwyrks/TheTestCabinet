// check/check-reports-cost-with-a-readiness-issue — a check with a readiness
// issue still reports the cost and the budget.
//
// specs/structure.md § The static check names what a readiness issue withholds
// and no more: "With any readiness issue the structure is not solved ... A
// structure that is not solved does not stand ... and it reports no member at
// all." The verdict and the member list are the whole of it. The table above
// those sentences says the cost and the budget change "with the structure" alone,
// so they are reported whether or not the structure was solved.
//
// THE CRANE IS ONE STRUT AND NO RING. `no-ring` is the readiness issue every
// crane without a slew ring raises (specs/structure.md § Readiness), and the lone
// strut makes the cost trivially known: four units of strut at
// `STRUT_COST_PER_UNIT` (`10`) is `40`, with no `RING_COST` to add because there
// is no ring. Turnabout's budget is `3600` (specs/sites.md), so the reading has a
// cost and a budget that are both plainly right or plainly wrong, beside a
// verdict of `false` and an empty member list.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { SITES, STRUT_COST_PER_UNIT } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Turnabout, whose budget is 3600. */
const SITE = 1;

/** The one strut placed, four units long. */
const LEN = 4;
const EXPECTED = LEN * STRUT_COST_PER_UNIT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the cost and the budget of a crane no-ring left unsolved", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addMember(0, 4, 0, 0, 8, 0, "strut");

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "issues-cost-budget-structure-cost",
    "issues, cost, budget, structure.cost.",
  );

  assertContains(
    result.issues,
    "no-ring",
    "the readiness issue a crane with no slew ring raises " +
      "(specs/structure.md § Readiness)",
  );
  assertTrue(
    !result.stable,
    "the verdict on a structure a readiness issue left unsolved",
  );
  assertLength(
    result.members,
    0,
    "the members a structure that is not solved reports",
  );
  assertEqual(
    result.cost,
    EXPECTED,
    `the crane's cost, ${LEN} units of strut at ${STRUT_COST_PER_UNIT} and no ` +
      "ring to pay for, reported although the solve was refused " +
      "(specs/structure.md § The static check)",
  );
  assertEqual(
    result.cost,
    structure.cost,
    "the cost the check reports, against the crane's cost the snapshot carries",
  );
  assertEqual(
    result.budget,
    SITES[SITE]!.budget,
    `the open site's budget, reported although the solve was refused ` +
      "(specs/structure.md § The static check)",
  );
});
