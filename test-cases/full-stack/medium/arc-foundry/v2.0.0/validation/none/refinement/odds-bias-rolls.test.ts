// refinement/odds-bias-rolls — the table is what the press draws from.
//
// specs/scrap-press.md fixes the roll: a rock "rolls one component of a random
// type at a random quality", with the quality drawn from "The five-tier
// distribution `REFINEMENT_ODDS[R]` for the run's current refinement level `R`".
// At `R8` that row is `[0, 0.30, 0.30, 0.30, 0.10]`, so Scrap is impossible and
// four tiers are reachable — which is the difference between a build that draws
// from the table and one that shows the table and rolls from something else.
//
// The press is set to `R8` and a small sample of rolls is drawn through
// `rollPress`, the operation `specs/instrumentation.md` carries for performing
// the one draw alone. Two things are read off it. Every draw lies inside the set
// the row names — a tier it weights above zero, so never Scrap — which is the
// half a build that reads the wrong row, or no row, fails. And the draws vary:
// the row weights Tuned, Charged and Primed equally, so a press drawing from it
// never lands the same tier on every one of this many rolls, and the sample
// holding at least two distinct tiers is what separates a draw from a constant.
// How often each tier comes up is the reviewer's to judge; nothing here counts
// the tiers against the row's weights.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertGreaterThanOrEqual,
  assertEqual,
} from "../assert";
import { REFINEMENT_MAX, REFINEMENT_ODDS } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** How many rolls are drawn. */
const ROLLS = 100;

/** How many distinct tiers a sample of a varying draw holds at the least. */
const DISTINCT = 2;

/** The tiers `REFINEMENT_ODDS[8]` gives a non-zero weight. */
const REACHABLE = REFINEMENT_ODDS[REFINEMENT_MAX]!.map((weight, index) =>
  weight > 0 ? index + 1 : 0,
).filter((tier) => tier !== 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rolls only tiers the R8 row weights, and more than one of them", async () => {
  await openYard(h, { refinement: REFINEMENT_MAX });

  const rolled: number[] = [];
  while (rolled.length < ROLLS) {
    rolled.push((await h.debug.rollPress()).quality);
  }
  await h.advance(1);
  await captureStill(h, "rolls");

  for (const [index, tier] of rolled.entries()) {
    assertContains(
      REACHABLE,
      tier,
      `the quality of roll ${index + 1} of ${ROLLS} at R${REFINEMENT_MAX}, ` +
        `whose row weights tiers ${REACHABLE.join(", ")} and Scrap at 0 ` +
        "(specs/scrap-press.md)",
    );
  }
  assertGreaterThanOrEqual(
    new Set(rolled).size,
    DISTINCT,
    `distinct tiers among ${ROLLS} draws at R${REFINEMENT_MAX}, whose row ` +
      "weights three tiers equally (specs/scrap-press.md)",
  );
  assertEqual(
    (await h.snapshot()).refinement,
    REFINEMENT_MAX,
    "the level the rolls were drawn at",
  );
});
