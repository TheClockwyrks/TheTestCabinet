// refinement/refused-at-max — the track has a top rung and stops there.
//
// specs/scrap-press.md fixes both the ceiling and the refusal: a run "carries a
// refinement level `R` on the nine-rung track `R0` through `R8`, at
// `REFINEMENT_MAX` (`8`)", and refining "is refused at `R8` and when the player
// cannot afford the next level". specs/instrumentation.md fixes that a refused
// operation does nothing and that the refusal is readable in the snapshot, with no
// Charge leaving the bank.
//
// This is the edge case at the other end of the track from
// `refused-unaffordable`, and it is its own point because the two refusals are
// two rules: the bank is deliberately full here, so affordability cannot be what
// is doing the refusing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  REFINEMENT_COSTS,
  REFINEMENT_MAX,
  REFINEMENT_ODDS,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Far more than any rung costs, so the price cannot be what refuses. */
const BANK = REFINEMENT_COSTS.reduce((sum, cost) => sum + cost, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("changes neither the level nor the bank at R8 with Charge to spare", async () => {
  openYard(h, { charge: BANK, refinement: REFINEMENT_MAX });
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.upgradeQuality();

  const s = h.snapshot();
  assertEqual(
    s.refinement,
    REFINEMENT_MAX,
    `the level after refining at R${REFINEMENT_MAX} (specs/scrap-press.md)`,
  );
  assertEqual(
    s.charge,
    BANK,
    `the bank after refining at R${REFINEMENT_MAX}: no Charge leaves it`,
  );
  // And the odds are still the top rung's, so nothing rolled over into a tenth
  // row that the track does not have.
  for (const [tier, weight] of REFINEMENT_ODDS[REFINEMENT_MAX]!.entries()) {
    assertCloseTo(
      s.qualityOdds[tier]!,
      weight,
      6,
      `the weight on tier ${tier + 1} after a refusal at the top rung`,
    );
  }
});
