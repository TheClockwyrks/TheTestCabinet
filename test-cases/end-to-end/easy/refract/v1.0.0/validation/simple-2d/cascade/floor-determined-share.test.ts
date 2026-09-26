// Refract — cascade/floor-determined-share: every generated board meets its tier's
// determined-share floor.
//
// specs/modes/cascade.md "The difficulty floor": each rung sets a floor on the
// difficulty of the boards it emits, and every board the generator emits
// satisfies every bound its tier's row of "The floor, by tier" states. This
// point decides ONE of the five measures: "The count of channel-and-segment pairs that appear in every
// solution, as a share of L", at most the figure the tier's row states.
//
// The generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md) — so every tier's floor is exercised — and each
// board is re-measured, as it arrives, with the oracle's own enumeration over
// the notation read off the snapshot, held to the row of the tier it was asked
// for at. The still is the last MAX_TIER board, the tier with the tallest
// floor.
//
// A BOARD THE ORACLE CANNOT MEASURE IS NOT JUDGED. The enumeration carries an
// expansion budget (DIFFICULTY_MAX_EXPANSIONS, a generous runaway stop) so a
// pathological board cannot hang the suite. When that budget runs out the
// oracle is admitting it could not read the measures — a fact about this
// module, never a verdict on the build — so the board is set aside rather than
// failed. So the point can never pass by setting everything aside, the
// sweep must still measure at least twenty of its twenty-five boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
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

it("emits only boards staying under their tier's determined-share ceiling", async () => {
  await resetTo(h);

  let unmeasured = 0;
  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    const row = TIERS[tier - 1];
    const context = `tier ${tier}, board ${round}`;
    const { measured } = measuresUpToTier(board, tier);
    if (measured === null || measured.budget) {
      unmeasured += 1;
      return;
    }
    assertLessThanOrEqual(
      measured.determinedShare,
      row.maxDeterminedShare + 1e-9,
      `${context}: determined share ` +
        `${measured.determinedShare.toFixed(3)} ` +
        '(specs/modes/cascade.md "The floor, by tier")',
    );
  });

  // The verdict is never vacuous: enough of the sweep was really measured.
  assertLessThan(
    unmeasured,
    6,
    "at least twenty of the twenty-five generated boards measured inside the " +
      "oracle's expansion budget",
  );
});
