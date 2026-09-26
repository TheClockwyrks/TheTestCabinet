// Facet — instrumentation/set-refill-kinds-deals-the-pose: a posed refill deals
// the posed kinds into the cells R9 refills, from the top of the column down.
//
// WHAT THE SPECIFICATION ASKS FOR. specs/instrumentation.md, of
// `setRefillKinds(col, kinds)`: "the gem the refill deals into row `r` of that
// column takes the kind `kinds[r]` names, `plain` at strain `0` and with the
// `fell` R9 gives it, in place of the draw R9 states." The pose is what takes
// R9's draw out of a scenario's way, so every check that states a settled board
// exactly — the clock's, the mute key's — rests on it dealing what it was told.
//
// HOW THE SCENARIO ISOLATES THAT. A vertical run of three at the FOOT of column
// 4, rows 5 to 7, posed on the run-free filler, with three different kinds posed
// for that column's refill. The whole gap is at the foot, so R9 refills exactly
// rows 0 to 2 of column 4 and nothing else, and the three refilled cells are read
// against the three letters, top down. Three DIFFERENT kinds are what make the
// reading discriminating: a build that dealt the pose bottom up, or the first
// letter into every cell, puts the wrong kind at an asserted cell rather than an
// indistinguishable one.
//
// WHAT IS DELIBERATELY LEFT UNASSERTED. Where the survivors landed is
// `settling/r9-gems-fall`'s point over this same scenario, and how far a refilled
// gem reports having traveled is `settling/r9-refill-falls-from-above`'s. What
// is read here is the kind, the cut and the strain of the three refilled cells,
// which is the whole of what the pose fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWith,
  renderCell,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  poseRefill,
  swapAndStep,
  type Harness,
} from "../harness";

/** The column whose foot the step clears, and whose refill is posed. */
const COL = 4;

/** Three rubies that make a vertical run at the foot of column 4 once the middle one trades in. */
const SCENARIO: readonly PlacedToken[] = [
  { col: COL, row: 5, token: "R0" },
  { col: COL, row: 7, token: "R0" },
  { col: COL + 1, row: 6, token: "R0" },
];

/** The swap that completes the run: the parked ruby trades into `(4,6)`. */
const A: CellRef = { col: COL, row: 6 };
const B: CellRef = { col: COL + 1, row: 6 };

/** The three cells the swap's run seeds, top to bottom. */
const CLEAR_SET: readonly CellRef[] = [
  { col: COL, row: 5 },
  { col: COL, row: 6 },
  { col: COL, row: 7 },
];

/**
 * The kinds posed for column 4's refill: a citrine into row 0, a jade into row
 * 1, a beryl into row 2. Three letters for the three cells the step refills.
 */
const POSE = "CJB";

/** What each refilled cell holds once the pose has been dealt, top down. */
const EXPECTED = ["C0", "J0", "B0"];

let h: Harness;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals the posed kinds into the refilled cells, top down", async () => {
  requireSurface();
  const posed = quietRowsWith(SCENARIO);
  // The arrangement is the check's argument, so it is proved rather than
  // asserted: the posed board carries no run of its own, and the swap's run
  // seeds exactly the three cells at the foot of column 4, so the refill lands
  // in rows 0 to 2 of that column and nowhere else.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(swapped(posed, A, B)),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  await loadBoard(h, posed);
  await poseRefill(h, [[COL, POSE]]);
  const settled = await swapAndStep(h, A, B);
  assertEqual(settled.chainStep, 1, "the chain step the swap opened");

  // Each refilled cell, read as the token it holds: the posed kind, `plain`, at
  // strain `0`, in the order the letters were written.
  EXPECTED.forEach((token, row) => {
    assertEqual(
      renderCell(settled, COL, row),
      token,
      `the gem the refill dealt into (${COL},${row})`,
    );
  });

  await h.advance(1);
  await captureStill(h, "refilled");
});
