// Facet — strain/r7-once-per-step: strain is raised once per STEP, not once per
// cleared neighbor.
//
// R7 of specs/rules.md says it twice, and the second sentence is this point: "A
// gem gains at most 1 strain in a step, however many of its neighbors the clear
// set holds." The obvious implementation — walk the clear set and bump each of
// its four neighbors — gets the ordinary case right and this one wrong, and
// the error is a large one: MAX_STRAIN is 3, so a gem that gains 2 or 3 at a
// time reaches flawed in one or two clears instead of three, and every figure
// that hangs off flawed (R6's flawed addition, FLAWED_SCORE, the flaw cue)
// fires early for the rest of the round.
//
// THE SCENARIO. One clear, shaped as an L. A horizontal ruby run of three lies
// along row 4 at columns 2, 3 and 4, and a vertical ruby run of three lies down
// column 4 at rows 4, 5 and 6; they share the corner cell (4,4), so both are
// seeded by R5 into ONE clear set of five cells. Both arms are completed by a
// single exchange, which trades the ruby at (5,4) into the empty corner at
// (4,4).
//
// The jade at (3,5) sits in the inside of that L. Its four orthogonal
// neighbors are (3,4) — the horizontal arm — and (4,5) — the vertical arm —
// both in the clear set, plus two cells that are not. So it is the gem the
// rule's second sentence is written about: it borders the clear set twice and
// must come out of the step at strain 1, not 2.
//
// Column 3 loses only the cell above the jade, so R9 leaves it exactly where it
// was posed.
//
// WHEN THE READING IS TAKEN. specs/rules.md holds an accepted swap in
// `swapping` for SWAP_SECONDS (0.18) of game time, clearing nothing, and
// resolves step 1 when that time is spent. `swapAndStep` carries the game
// exactly that far and hands back the reading step 1 left; the step then holds
// the board for its own STEP_HOLD — `lastWaves x WAVE_SECONDS` plus `lastFall x
// FALL_SECONDS_PER_ROW` plus STEP_SECONDS — before it is read again. So the
// strain reported is one step's worth, and a second step of the chain cannot
// have added the strain this point is looking for the absence of.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  clearSetFromRuns,
  maximalRuns,
  neighbors,
  quietRowsWithEscape,
  renderBoard,
  swapped,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  swapAndStep,
  type Harness,
} from "../harness";

/** The board the scenario poses over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  // The horizontal arm, short of its corner.
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 4, token: "R0" },
  // The vertical arm, short of the same corner.
  { col: 4, row: 5, token: "R0" },
  { col: 4, row: 6, token: "R0" },
  // The corner itself, and the ruby that is traded into it from the right.
  { col: 4, row: 4, token: "S0" },
  { col: 5, row: 4, token: "R0" },
  // The marked gem, in the inside of the L.
  { col: 3, row: 5, token: "J0" },
];

/** The exchange that completes both arms at once. */
const SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 5, row: 4 },
  b: { col: 4, row: 4 },
};

/** The five cells the two runs seed, as one clear set. */
const CLEARED: readonly CellRef[] = [
  { col: 2, row: 4 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
  { col: 4, row: 5 },
  { col: 4, row: 6 },
];

/**
 * The gem cornered by the two arms. It does not move: the only cell its
 * column loses is (3,4), which is above it.
 */
const MARKED: CellRef = { col: 3, row: 5 };

/** What it must read: one strain gained, from the one step, not two. */
const EXPECTED = "J1";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises a gem bordering two cleared cells by one strain only", async () => {
  const posed = quietRowsWithEscape(CELLS);
  const resolved = swapped(posed, SWAP.a, SWAP.b);
  const bordering = neighbors(MARKED.col, MARKED.row).filter((beside) =>
    CLEARED.some((cell) => cell.col === beside.col && cell.row === beside.row),
  );

  // The fixture states its own premises: the posed board rests, the swap seeds
  // one clear set of five cells shaped as an L, and the marked gem borders TWO
  // of them. Two is what makes this scenario the rule's second sentence rather
  // than its first, so it is asserted rather than assumed.
  assertLength(maximalRuns(posed), 0, "runs on the posed board");
  assertDeepEqual(clearSetFromRuns(resolved), CLEARED, "the step's clear set");
  assertLength(bordering, 2, "cleared cells beside the marked gem");

  await loadBoard(h, posed);

  const taken = await captureReplay(h, "strain", async () => {
    // Through the swap animation to the result of step 1, read inside that
    // step's own hold so the strain it carries was raised by one step alone.
    // The chain is driven on afterwards only so the replay holds the whole move.
    const stepOne = await swapAndStep(h, SWAP.a, SWAP.b);
    const read = { rows: renderBoard(stepOne), chainStep: stepOne.chainStep };
    await resolveChain(h);
    return read;
  });

  assertEqual(taken.chainStep, 1, "the chain step the accepted swap opened");
  assertEqual(
    tokenAt(taken.rows, MARKED.col, MARKED.row),
    EXPECTED,
    `the jade at (${MARKED.col},${MARKED.row}), bordering two cleared cells`,
  );
});
