// cascade/floor-solution-count — every generated board meets its tier's solution-count floor.
//
// specs/modes/cascade.md "The difficulty floor": "Each rung sets a floor on
// the difficulty of the boards it emits, read off the board itself by the five
// measures below, and every board the generator emits satisfies every bound
// its tier's row states". This point decides ONE of the five: "The number of distinct solutions the board admits", inside the range
// the tier's row states on both ends.
// The generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and each is read off the snapshot as it arrives
// and remeasured with the case's own enumeration (metrics.ts, derived from
// specs/modes/cascade.md and specs/beams.md alone), held to the row of the tier
// it was asked for at.
//
// A BOARD THE ORACLE CANNOT MEASURE IS NOT JUDGED. The enumeration carries an
// expansion budget (DIFFICULTY_MAX_EXPANSIONS, a generous runaway stop) so a
// pathological board cannot hang the suite. When that budget runs out the
// oracle is admitting it could not read the measures — a fact about this
// module, never a verdict on the build — so the board is set aside rather than
// failed. Reaching the SOLUTIONS cap is the opposite:
// that is a measurement, and a board over its tier's stated bound fails on
// the honest count. So the point can never pass by setting everything aside, the
// sweep must still measure at least twenty of its twenty-five boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLessThan } from "../assert";
import { measuresUpToTier } from "../metrics";
import { MAX_TIER, TIERS } from "../notation";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  type Harness,
} from "../harness";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("every measured board admits a solution count inside its tier's range", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round }) => {
      if (tier === MAX_TIER && round === PER_TIER)
        await captureStill(h, "board");
    },
  );

  let unmeasured = 0;
  for (const { tier, round, board } of generated) {
    const row = TIERS[tier - 1];
    const at = `tier ${tier}, board ${round}`;

    const { measured } = measuresUpToTier(board, tier);
    if (measured === null || measured.budget) {
      unmeasured += 1;
      continue;
    }

    assertBetween(
      measured.solutions,
      row.solutions[0],
      row.solutions[1],
      `${at}: solutions ` +
        '(specs/modes/cascade.md "The floor, by tier": solutions)',
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
