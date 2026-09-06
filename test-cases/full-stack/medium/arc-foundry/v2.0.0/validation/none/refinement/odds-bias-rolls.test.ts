// refinement/odds-bias-rolls — the table is what the press draws from.
//
// specs/scrap-press.md fixes the roll: a rock "rolls one component of a random
// type at a random quality", with the quality drawn from "The five-tier
// distribution `REFINEMENT_ODDS[R]` for the run's current refinement level `R`".
// At `R8` that row is `[0, 0.30, 0.30, 0.30, 0.10]`, so Scrap is impossible and
// each of the other four tiers is reachable — which is the difference between a
// build that draws from the table and one that shows the table and rolls from
// something else.
//
// The press is set to `R8` and a bounded sample of rolls is drawn through
// `rollPress`, the operation `specs/instrumentation.md` carries for performing
// the one draw alone. What is read is only what the row makes certain: no Scrap
// at all, and every reachable tier seen at least once. The rarest tier is
// weighted `0.10`, so over this many rolls its count sits at `40 ± 6`, and a
// conformant build missing it is nearly seven standard deviations out.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { REFINEMENT_MAX, REFINEMENT_ODDS } from "../constants";
import { captureStill, createHarness, openYard, type Harness } from "../harness";

/** How many rolls are drawn. */
const ROLLS = 400;

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

it("rolls no Scrap at R8 and reaches every tier the row allows", async () => {
  await openYard(h, { refinement: REFINEMENT_MAX });

  const rolled: number[] = [];
  while (rolled.length < ROLLS) {
    rolled.push((await h.debug.rollPress()).quality);
  }
  await h.advance(1);
  await captureStill(h, "rolls");

  assertLength(rolled, ROLLS, "rolls drawn");
  assertEqual(
    rolled.filter((tier) => tier === 1).length,
    0,
    `Scrap rolls over ${ROLLS} draws at R${REFINEMENT_MAX}, whose row weights ` +
      `Scrap at 0 (specs/scrap-press.md)`,
  );
  for (const tier of REACHABLE) {
    assertContains(
      rolled,
      tier,
      `tier ${tier} among ${ROLLS} draws at R${REFINEMENT_MAX}, whose row ` +
        `weights it at ${REFINEMENT_ODDS[REFINEMENT_MAX]![tier - 1]!}`,
    );
  }
  assertEqual(
    (await h.snapshot()).refinement,
    REFINEMENT_MAX,
    "the level the rolls were drawn at",
  );
});
