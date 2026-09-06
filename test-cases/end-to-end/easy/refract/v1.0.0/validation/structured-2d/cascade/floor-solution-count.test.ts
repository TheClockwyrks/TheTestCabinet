// Refract — cascade/floor-solution-count: every generated board meets its tier's
// solution-count floor.
//
// specs/modes/cascade.md "The difficulty floor": each rung sets a floor on the
// difficulty of the boards it emits, and every board the generator emits
// satisfies every bound its tier's row of "The floor, by tier" states. This
// point decides ONE of the five measures: "The number of distinct solutions the board admits", inside the range
// the tier's row states on both ends.
//
// The generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and the measures are recomputed from scratch over
// the oracle's own parse of each arrived board (metrics.ts, derived from the
// specs alone), held to the row of the tier it was asked for at.
//
// A BOARD THE ORACLE CANNOT MEASURE IS NOT JUDGED. The enumeration carries an
// expansion budget (DIFFICULTY_MAX_EXPANSIONS, a generous runaway stop) so a
// pathological board cannot hang the suite. When that budget runs out the
// oracle is admitting it could not read the measures — a fact about this
// module, never a verdict on the build — so the board is set aside rather than
// failed. Reaching the SOLUTIONS cap is the opposite: that is a
// measurement, and a board over its tier's stated bound fails on the honest
// count. So the point can never pass by setting everything aside, the
// sweep must still measure at least twenty of its twenty-five boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  type Harness,
} from "../harness";
import { measuresUpToTier } from "../metrics";
import { MAX_TIER, TIERS } from "../notation";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards whose solution count sits inside its tier's range", async () => {
  const generated = await generateAtTiers(h, PER_TIER, ({ tier, round }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
  });
  let unmeasured = 0;
  for (const { tier, round, board } of generated) {
    const row = TIERS[tier - 1];
    const context = `tier ${tier}, board ${round}`;
    const { measured } = measuresUpToTier(board, tier);
    if (measured === null || measured.budget) {
      unmeasured += 1;
      continue;
    }
    assertBetween(
      measured.solutions,
      row.solutions[0],
      row.solutions[1],
      `${context}: solutions (specs/modes/cascade.md "The floor, by tier")`,
    );
  }

  // The verdict is never vacuous: enough of the sweep was really measured.
  assertLessThan(
    unmeasured,
    6,
    "at least twenty of the twenty-five generated boards measured inside the " +
      "oracle's expansion budget",
  );
});
