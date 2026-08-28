// Refract — cascade/boards-meet-the-tier-floor: every generated board meets
// its tier's difficulty floor.
//
// specs/modes/cascade.md "The difficulty floor": each rung sets a floor on
// the difficulty of the boards it emits — routes per channel, solutions,
// determined share, branching factor, and shared crystals, each within the
// bounds its row of "The floor, by tier" states — and every board the
// generator emits satisfies every bound. The same twenty-five-board sweep the
// sibling suites drive is measured here: board k arrives after exactly k
// solves, so its rung is the formula's tier at k, and the five measures are
// recomputed from scratch over the oracle's own parse of the arrived board
// (metrics.ts, derived from the specs alone) and held against that rung.
//
// RESIDUAL RISK, documented: the enumeration caps its node expansions as a
// runaway stop. A conformant generator could in principle emit a board the
// enumeration cannot finish inside the budget; that failure names the budget
// so it is read for what it is — an unmeasured board, never a pass. Boards
// within 7x6 with 1-3 channels measure in well under the budget in practice.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { measuresUpToTier } from "../metrics";
import { tierForSolvedCount } from "../notation";

const SEED = 1;
const BOARDS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards meeting their tier's difficulty floor, across the whole sweep", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    const tier = tierForSolvedCount(k);
    const context = `board ${k + 1}, tier ${tier}`;
    const { measured, ok } = measuresUpToTier(solved[k].board, tier);
    if (measured === null || measured.capped) {
      fail(
        `a generated board the oracle's enumeration can measure within its ` +
          `expansion budget (a documented residual risk of the budget, not ` +
          `a verdict on the board) (${context})`,
        measured === null
          ? "the enumeration budget stopped before any measure was read"
          : "the enumeration budget stopped with the measures incomplete",
      );
    }
    if (!ok) {
      fail(
        `a board within every bound its tier's row of the difficulty floor ` +
          `states — routes per channel, solutions, determined share, ` +
          `branching factor, shared crystals (specs/modes/cascade.md ` +
          `"The floor, by tier") (${context})`,
        `solutions ${measured.solutions}, determined share ` +
          `${measured.determinedShare.toFixed(3)}, branching ` +
          `${measured.branching.toFixed(3)}, shared crystals ` +
          `${measured.sharedCrystals}, routes [${measured.routes.join(", ")}]`,
      );
    }
  }

  // One more board past the sweep, rendered on playing: the picture.
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "NEXT BOARD lands on playing");
  // A generated board meeting its tier's floor.
  captureStill(h, "board");
});
