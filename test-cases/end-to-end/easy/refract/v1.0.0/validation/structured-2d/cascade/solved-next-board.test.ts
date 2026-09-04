// Refract — cascade/solved-next-board: NEXT BOARD hands the player a fresh
// board at the tier the run has reached.
//
// specs/modes/cascade.md's solved-screen table: NEXT BOARD "Generates a board
// at the current `state.tier` and moves to `playing` with every beam empty."
// The clause that makes it NEXT BOARD rather than RESTART is what it does NOT
// touch — the run's progress — so the count and the tier are read after the
// choice as well as before it, and cascade/restart owns the opposite reading.
//
// THE WORLD IS POSED, not generated — and deliberately not through
// `solveGenerated`, which presses `confirm` on the solved screen between
// boards. Arranging with it would exercise NEXT BOARD four times to set up the
// check on NEXT BOARD, and would drag the generator and the solver onto a
// point about a menu choice. Five boards are posed through `loadBoard` — "a
// board posed this way is a board like any other"
// (specs/instrumentation.md) — which moves straight to `playing` with every
// beam empty, so no NEXT BOARD press occurs during the arrangement. That
// posed solves raise the count is cascade/cascade-solved-copy's point,
// asserted here as a named precondition.
//
// FIVE SOLVES, NOT ONE. At tier 1 the claim "generates a board at the current
// state.tier" is unfalsifiable, because 1 is also the resting value a build
// that ignored the tier entirely would report. TIER_ADVANCE (5) solves put the
// run on tier 2, so the carried tier is a figure the run reached rather than
// the one it started on; tierForSolvedCount is the spec's own formula from
// notation.ts, and cascade/tier-ladder owns the climb itself.
//
// THE NEW BOARD'S GRID IS NOT READ AGAINST ITS TIER HERE. That claim belongs
// to cascade/tier-grid-range, which reads every board of a twenty-five-board
// sweep against its tier's row of TIERS. What this point decides is that the
// choice hands over a board at all, empty, with the run's progress intact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GEO_3X3 } from "../fixtures";
import { TIER_ADVANCE, tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  startCascade,
  tapAction,
  traceRoute,
  type Harness,
} from "../harness";
import { assertEveryBeamEmpty } from "./helpers";

/** The forced GEO_3X3 solve: T(0,0) — t(1,1) — T(2,2) (fixtures.ts). */
const GEO_3X3_ROUTE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 2],
];

/** The tier the run has reached after TIER_ADVANCE solves: 2, not the resting 1. */
const REACHED_TIER = tierForSolvedCount(TIER_ADVANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("NEXT BOARD opens an empty board and carries the count and the tier forward", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  // Five posed solves, none of them through the choice under test.
  for (let solve = 0; solve < TIER_ADVANCE; solve += 1) {
    await loadBoard(h, GEO_3X3);
    traceRoute(h, GEO_3X3_ROUTE);
  }

  const arrived = h.snapshot();
  assertEqual(
    arrived.screen,
    "solved",
    "precondition: the posed solves reach the solved screen " +
      "(see cascade-solved-reached)",
  );
  assertEqual(
    arrived.solvedCount,
    TIER_ADVANCE,
    `precondition: ${TIER_ADVANCE} posed solves are counted ` +
      "(see cascade-solved-copy)",
  );
  assertEqual(
    arrived.tier,
    REACHED_TIER,
    `precondition: the run has climbed to tier ${REACHED_TIER} ` +
      "(see tier-ladder)",
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "precondition: NEXT BOARD is highlighted on arriving at solved",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  // The fresh board NEXT BOARD handed the player.
  captureStill(h, "board");

  const next = h.snapshot();
  assertEqual(next.screen, "playing", "NEXT BOARD moves to playing");
  assertGreaterThan(
    next.board.nodes.length,
    0,
    "NEXT BOARD generates a board (specs/modes/cascade.md)",
  );
  assertEveryBeamEmpty(next, "the board NEXT BOARD handed over");
  assertEqual(
    next.solvedCount,
    TIER_ADVANCE,
    "NEXT BOARD carries the run's progress forward",
  );
  assertEqual(
    next.tier,
    REACHED_TIER,
    "and the tier it has reached — this is what separates NEXT BOARD " +
      "from RESTART",
  );
});
