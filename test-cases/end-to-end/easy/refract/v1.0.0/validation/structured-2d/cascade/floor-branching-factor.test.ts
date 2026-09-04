// Refract — cascade/floor-branching-factor: every generated board meets its tier's
// branching-factor floor.
//
// specs/modes/cascade.md "The difficulty floor": each rung sets a floor on the
// difficulty of the boards it emits, and every board the generator emits
// satisfies every bound its tier's row of "The floor, by tier" states. This
// point decides ONE of the five measures: the mean, over every segment of every solution, of the moves rules
// R1 to R5 allow from the beam's current end with everything drawn so far
// in place, at least the figure the tier's row states.
//
// The same twenty-five-board sweep the sibling suites drive is measured here:
// board k arrives after exactly k solves, so its rung is the formula's tier at
// k, and the measures are recomputed from scratch over the oracle's own parse
// of the arrived board (metrics.ts, derived from the specs alone).
//
// A BOARD THE ORACLE CANNOT MEASURE IS NOT JUDGED. The enumeration carries an
// expansion budget (DIFFICULTY_MAX_EXPANSIONS, a generous runaway stop) so a
// pathological board cannot hang the suite. When that budget runs out the
// oracle is admitting it could not read the measures — a fact about this
// module, never a verdict on the build — so the board is set aside rather than
// failed. So the point can never pass by setting everything aside, the
// sweep must still measure at least twenty of its twenty-five boards.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { measuresUpToTier } from "../metrics";
import { TIERS, tierForSolvedCount } from "../notation";

const SEED = 1;
const BOARDS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards meeting their tier's branching floor", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  let unmeasured = 0;
  for (let k = 0; k < solved.length; k += 1) {
    const tier = tierForSolvedCount(k);
    const row = TIERS[tier - 1];
    const context = `board ${k + 1}, tier ${tier}`;
    const { measured } = measuresUpToTier(solved[k].board, tier);
    if (measured === null || measured.budget) {
      unmeasured += 1;
      continue;
    }
    assertGreaterThanOrEqual(
      measured.branching,
      row.minBranching - 1e-9,
      `${context}: branching ${measured.branching.toFixed(3)} ` +
        '(specs/modes/cascade.md "The floor, by tier")',
    );
  }

  // The verdict is never vacuous: enough of the sweep was really measured.
  assertLessThan(
    unmeasured,
    6,
    "at least twenty of the sweep's twenty-five boards measured inside the " +
      "oracle's expansion budget",
  );

  // One more board past the sweep, rendered on playing: the picture.
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "NEXT BOARD lands on playing");
  captureStill(h, "board");
});
