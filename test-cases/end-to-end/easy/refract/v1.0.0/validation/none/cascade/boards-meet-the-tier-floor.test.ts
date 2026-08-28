// cascade/boards-meet-the-tier-floor — every generated board meets its tier's
// difficulty floor.
//
// specs/modes/cascade.md "The difficulty floor": "Each rung sets a floor on
// the difficulty of the boards it emits, read off the board itself by the five
// measures below, and every board the generator emits satisfies every bound
// its tier's row states" — routes per channel, solutions, determined share,
// branching factor, and shared crystals, as "The floor, by tier" bounds them.
// The sweep reads each board off the snapshot as it arrives and recomputes the
// five measures with the case's own enumeration (metrics.ts, derived from
// specs/modes/cascade.md and specs/beams.md alone), held to the row of the
// tier the run stood at when the board was generated — the spec's own formula
// over the arrival snapshot's solvedCount, as in tier-shapes-the-board. A
// board the enumeration cannot finish is a FAILURE, not a pass: the floor is
// only met by a board whose measures were actually read.
//
// RESIDUAL RISK, ACCEPTED: the enumeration carries an expansion budget
// (DIFFICULTY_MAX_EXPANSIONS, a generous runaway stop) so a pathological board
// cannot hang the suite. Boards within the ladder's sizes resolve well inside
// it; a conformant board the budget stops on would fail this point wrongly,
// and that risk is accepted as vanishingly small rather than hidden.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { measuresUpToTier } from "../metrics";
import { tierForSolvedCount } from "../notation";
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

it("every board of the sweep meets the five bounds its tier's floor states", async () => {
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

  for (const [index, board] of sweep.boards.entries()) {
    const tier = tierForSolvedCount(arrivals[index].solvedCount);
    const at = `board ${index + 1} (tier ${tier})`;

    const { measured, ok } = measuresUpToTier(board, tier);
    if (measured === null || measured.capped) {
      fail(
        `${at}: measures read to completion — the enumeration's expansion ` +
          "budget stopped before every solution was counted, so the board is " +
          "unmeasured, and an unmeasured board is a failure, not a pass",
        measured === null ? "no measures" : "capped enumeration",
      );
    }
    assertTrue(
      ok,
      `${at}: every bound of its tier's difficulty floor — routes per ` +
        "channel, solutions, determined share, branching factor, shared " +
        'crystals (specs/modes/cascade.md "The difficulty floor", ' +
        `"The floor, by tier"); measured: solutions ${measured.solutions}, ` +
        `determined share ${measured.determinedShare.toFixed(3)}, ` +
        `branching ${measured.branching.toFixed(3)}, ` +
        `shared crystals ${measured.sharedCrystals}, ` +
        `routes [${measured.routes.join(", ")}]`,
    );
  }
});
