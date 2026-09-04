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
// The press is set to `R8` and several hundred rocks are dropped through the real
// placement path, five to a stamp allowance, each read and then dismantled so the
// next rock lands on Open tiles again. What is read is only what the row makes
// certain: no Scrap at all, and every reachable tier seen at least once. Those two
// readings hold whatever seed the run was opened at — over this many rolls, a
// conformant build missing a tier is a one-in-a-billion event — so the check is
// not resting on one particular sequence of draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  REFINEMENT_MAX,
  REFINEMENT_ODDS,
  STAMPS_PER_LEVEL,
} from "../../src/constants";
import {
  captureStill,
  clearHand,
  createHarness,
  DEFAULT_SEED,
  lastStructure,
  openYard,
  refillStamps,
  type Harness,
} from "../harness";

/** One anchor per stamp of an allowance, each footprint two tiles clear. */
const ANCHORS = Array.from({ length: STAMPS_PER_LEVEL }, (_, index) => ({
  col: 8 + index * 4,
  row: 10,
}));

/** How many rocks are rolled. Forty allowances of five. */
const ROLLS = 200;

/** The tiers `REFINEMENT_ODDS[8]` gives a non-zero weight. */
const REACHABLE = REFINEMENT_ODDS[REFINEMENT_MAX]!.map((weight, index) =>
  weight > 0 ? index + 1 : 0,
).filter((tier) => tier !== 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("rolls no Scrap at R8 and reaches every tier the row allows", async () => {
  openYard(h, { seed: DEFAULT_SEED, refinement: REFINEMENT_MAX });

  const rolled: number[] = [];
  while (rolled.length < ROLLS) {
    refillStamps(h);
    const placed: number[] = [];
    for (const anchor of ANCHORS) {
      h.debug.placeRock(anchor.col, anchor.row);
      const candidate = lastStructure(h.snapshot());
      assertEqual(
        candidate.kind,
        "candidate",
        "a dropped rock rolls into a candidate (specs/scrap-press.md)",
      );
      rolled.push(candidate.quality ?? 0);
      placed.push(candidate.id);
    }
    if (rolled.length >= ROLLS) break;
    for (const id of placed) h.debug.dismantle(id);
  }
  await clearHand(h);
  await h.advance(1);
  captureStill(h, "rolls");

  assertLength(rolled, ROLLS, "rocks rolled");
  assertEqual(
    rolled.filter((tier) => tier === 1).length,
    0,
    `Scrap rolls over ${ROLLS} rocks at R${REFINEMENT_MAX}, whose row weights ` +
      `Scrap at 0 (specs/scrap-press.md)`,
  );
  for (const tier of REACHABLE) {
    assertContains(
      rolled,
      tier,
      `tier ${tier} among ${ROLLS} rolls at R${REFINEMENT_MAX}, whose row ` +
        `weights it at ${REFINEMENT_ODDS[REFINEMENT_MAX]![tier - 1]!}`,
    );
  }
  assertEqual(
    h.snapshot().refinement,
    REFINEMENT_MAX,
    "the level the rolls were drawn at",
  );
});
