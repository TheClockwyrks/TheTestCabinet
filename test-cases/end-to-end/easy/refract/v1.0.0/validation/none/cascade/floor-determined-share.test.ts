// cascade/floor-determined-share — every generated board meets its tier's determined-share floor.
//
// specs/modes/cascade.md "The difficulty floor": "Each rung sets a floor on
// the difficulty of the boards it emits, read off the board itself by the five
// measures below, and every board the generator emits satisfies every bound
// its tier's row states". This point decides ONE of the five: "The count of channel-and-segment pairs that appear in every solution,
// as a share of L", at most the figure the tier's row states.
// The sweep reads each board off the snapshot as it arrives and recomputes the
// measures with the case's own enumeration (metrics.ts, derived from
// specs/modes/cascade.md and specs/beams.md alone), held to the row of the tier
// the run stood at when the board was generated — the spec's own formula over
// the arrival snapshot's solvedCount, as in tier-grid-range.
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
import { measuresUpToTier } from "../metrics";
import { TIERS, tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  solveGenerated,
  type Harness,
  type RefractSnapshot,
} from "../harness";

const SWEEP = 25;
const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("every measured board stays under its tier's determined-share ceiling", async () => {
  const arrivals: RefractSnapshot[] = [];
  const sweep = await solveGenerated(
    h,
    SWEEP,
    SEED,
    async (snapshot, index) => {
      arrivals.push(snapshot);
      if (index === SWEEP - 1) await captureStill(h, "board");
    },
  );

  let unmeasured = 0;
  for (const [index, board] of sweep.boards.entries()) {
    const tier = tierForSolvedCount(arrivals[index].solvedCount);
    const row = TIERS[tier - 1];
    const at = `board ${index + 1} (tier ${tier})`;

    const { measured } = measuresUpToTier(board, tier);
    if (measured === null || measured.budget) {
      unmeasured += 1;
      continue;
    }

    assertLessThanOrEqual(
      measured.determinedShare,
      row.maxDeterminedShare + 1e-9,
      `${at}: determined share ${measured.determinedShare.toFixed(3)} ` +
        '(specs/modes/cascade.md "The floor, by tier": determined share)',
    );
  }

  // The verdict is never vacuous: enough of the sweep was really measured.
  assertLessThan(
    unmeasured,
    6,
    "at least twenty of the sweep's twenty-five boards measured inside the " +
      "oracle's expansion budget",
  );
});
