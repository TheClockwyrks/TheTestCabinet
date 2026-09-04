// Facet — moves/r2-refused-while-swapping: R2 refuses a swap while a swap is
// already in motion.
//
// R2 in specs/rules.md is one sentence — "A swap is accepted only while `phase`
// is `idle`, so a swap requested while one is already in motion or while a chain
// is running is refused" — and it names two situations, not one. `phase` is
// `swapping` while the two gems of an accepted swap are travelling between their
// cells, and `resolving` while a chain reads the board. A build that guards the
// second and not the first has a game in which a player can trade a gem out from
// under the pair already crossing the board: the exchange the first swap made is
// overwritten mid-flight, and what lands is a board neither move asked for. That
// is why this is its own point, apart from
// `moves/r2-refused-while-resolving` — the two clauses of one sentence are
// separately breakable, and a build that reads `phase !== "resolving"` passes
// that one and fails this.
//
// HOW THE SCENARIO ISOLATES R2, WHICH IS THE WHOLE DIFFICULTY. A refusal proves
// nothing unless the request would otherwise have been ACCEPTED. So the posed
// board carries two arrangements far apart from each other: a ruby scenario in
// the middle whose exchange R1 and R3 both take, and a beryl scenario in the
// top-right corner whose exchange is orthogonally adjacent and productive.
// Nothing has been cleared when the second request is made — an accepted swap
// "exchanges the two cells at once" and clears nothing until `SWAP_SECONDS`
// (`0.18`) of game time has gone by — so the corner pair is still R1- and
// R3-clean, and the check proves that against the board the BUILD is holding at
// that moment rather than against the fixture. What the second request meets is
// exactly one objection: R2.
//
// WHERE IN THE ANIMATION THE REQUEST LANDS. Five frames of the suite's clock is
// `0.078125` s, well short of `SWAP_SECONDS`, so the first pair is still in
// motion and `swapTimer` is carrying a figure a restart would visibly lose. A
// build that answered the request by accepting it shows the corner pair
// exchanged; one that answered it by starting the swap over shows `swapTimer`
// back at zero.
//
// WHAT IS READ. All sixty-four cells, compared as text against the board the
// FIRST exchange left rather than against the posed board: R2 owes that the
// second request changed nothing, and the first swap is entitled to have changed
// two cells. `phase` and `swapTimer` are read for the same reason — the swap in
// motion carries on undisturbed. The refusal MARK belongs to
// `moves/refusal-marked` and is not read here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  assertBoardEquals,
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  swapped,
  type BoardRows,
  type CellRef,
} from "../board";
import { SWAP_SECONDS } from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/** One requested exchange, named as R1 names its two cells. */
interface Pair {
  a: CellRef;
  b: CellRef;
}

/**
 * Two arrangements on one run-free board, far enough apart that neither can
 * reach the other.
 *
 * The rubies at `(2,4)`, `(4,4)` and `(3,3)` make the opening move: trading
 * `(3,3)` down completes row 4 over columns 2, 3 and 4. The beryls at `(5,1)`,
 * `(7,1)` and `(6,0)` make the second: trading `(6,0)` down completes row 1 over
 * columns 5, 6 and 7. The opening exchange touches column 3 alone, so it cannot
 * change what R1 and R3 say about the corner pair.
 */
const ROWS: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 5, row: 1, token: "B0" },
  { col: 7, row: 1, token: "B0" },
  { col: 6, row: 0, token: "B0" },
]);

/** The move that is accepted and set travelling. */
const OPENING: Pair = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

/** The move requested over it, which R1 and R3 both welcome. */
const SECOND: Pair = { a: { col: 6, row: 0 }, b: { col: 6, row: 1 } };

/**
 * Frames advanced into the swap animation before the second request.
 *
 * Five frames of the suite's 64 Hz clock is `0.078125` s: well inside
 * `SWAP_SECONDS` (`0.18`), so the first pair is still travelling and no step has
 * resolved, and far enough in that `swapTimer` is carrying a figure worth
 * watching.
 */
const MID_SWAP_FRAMES = 5;

/** One frame after the request, so the replay closes on the refusal. */
const CLIP_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("refuses a swap requested while another is still in motion", async () => {
  // The fixture: a settled board carrying two independent moves.
  assertLength(maximalRuns(ROWS), 0, "runs on the posed board");
  assertTrue(
    swapIsLegal(ROWS, OPENING.a, OPENING.b),
    "the opening pair is a legal swap",
  );
  loadBoard(h, ROWS);

  // Set the first pair travelling. The exchange happens at once and nothing is
  // cleared, so the board is `swapping` at chain step 0.
  const opening = requestSwap(h, OPENING.a, OPENING.b);
  assertEqual(opening.phase, "swapping", "phase after the opening swap");
  assertEqual(opening.chainStep, 0, "chainStep after the opening swap");

  // Run part-way through the animation, so `swapTimer` holds a figure a restart
  // would lose.
  await h.advance(MID_SWAP_FRAMES);
  const before = h.snapshot();
  const boardBefore = h.board();
  assertEqual(before.phase, "swapping", "phase part-way through the animation");
  assertTrue(
    before.swapTimer > 0 && before.swapTimer < SWAP_SECONDS,
    `the swap timer is inside SWAP_SECONDS (${SWAP_SECONDS}): ${before.swapTimer}`,
  );

  // The load-bearing precondition, read off the board the build is holding: the
  // pair about to be requested is orthogonally adjacent and productive RIGHT
  // NOW, so R1 and R3 would both accept it and R2 is the only rule left.
  assertBoardEquals(
    boardBefore,
    swapped(ROWS, OPENING.a, OPENING.b),
    "the board the first exchange left",
  );
  assertTrue(
    swapIsLegal(boardBefore, SECOND.a, SECOND.b),
    "the second pair is a legal swap on the board mid-swap",
  );

  const refused = await captureReplay(h, "refused", async () => {
    const reading = requestSwap(h, SECOND.a, SECOND.b);
    const board = h.board();
    await h.advance(CLIP_FRAMES);
    return { reading, board };
  });

  // Nothing moved: not the cells the second request named, not any other cell,
  // and not the swap that was already travelling.
  assertBoardEquals(refused.board, boardBefore, "after the mid-swap request");
  assertEqual(refused.reading.phase, "swapping", "phase after the request");
  assertEqual(refused.reading.chainStep, 0, "chainStep after the request");
  // No frame ran between the reading before and the reading after, so the timer
  // has not merely failed to restart — it stands at exactly the figure it held.
  assertCloseTo(
    refused.reading.swapTimer,
    before.swapTimer,
    9,
    "swapTimer after the request",
  );
});
