// levels/level-before-gameover — a completed level is settled first, and a board
// with no move left on it does not end a round that has already been won.
//
// specs/rules.md states the two end-of-round conditions in an order, and the
// order is the rule: the level rule first, then "OTHERWISE, when `phase` returns
// to `idle` and no legal swap exists on the board, `screen` becomes `gameover`."
// Both conditions are met at the same moment here, and only the first may answer.
//
// WHY THIS IS ITS OWN QUESTION. A build that evaluates the two conditions in the
// other order, or that checks the board for a move before it checks the target,
// plays correctly every time the two do not coincide — which is nearly always.
// It goes wrong exactly once: on the clear that finishes a level and leaves
// nothing behind to play, where a round that was won is reported as lost. So the
// two are made to coincide on purpose.
//
// THE ARRANGEMENT IS THE GAMEOVER ONE, WITH THE TARGET MET. A chain is opened by
// an ordinary accepted swap; while its step is still holding, every cell is
// rewritten to the board of specs/rules.md's end condition — no run, no prism,
// and no exchange of adjacent cells that makes one — and `levelScore` is posed at
// the target the round reports. specs/instrumentation.md says `setGem` leaves the
// phase and the screen where they were and `setLevelScore` "changes nothing
// else", so what the step reads when its hold is up is a dead board on a finished
// level.
//
// WHAT THE WINNING ANSWER LOOKS LIKE. `levelclear`, and the board still dead
// underneath it: specs/rules.md hands the next level's deal to `CONTINUE` rather
// than to the settle, so nothing is dealt here and the board the round was won on
// is the board that stands. The dead board is read back with this project's own
// R1/R3 search, never off the build's derived `legalSwap`, which is
// `levels/legal-swap-derived`'s question.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`.
// What this point decides is the ORDER the two end conditions are evaluated in,
// and it decides that against whatever target the round is playing to; what that
// figure ought to be is `levels/level-target-derived`'s point, and a build that
// derives it wrongly owes that point rather than this one as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  deadBoard,
  hasAnyRun,
  legalSwapExists,
  parseRows,
  quietRowsWithEscape,
  swapIsLegal,
  tokenAt,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The exchange that drops the third ruby into row 4 and makes the run. */
const RUN_SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Write every cell of a board in the notation onto the live board, `setGem` by `setGem`. */
async function writeBoard(rows: BoardRows): Promise<void> {
  // Parsed on this side first, so a typo in the fixture fails here rather than
  // crossing into the build one cell at a time.
  parseRows(rows);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      await h.debug.setGem(col, row, tokenAt(rows, col, row));
    }
  }
}

it("clears the level rather than ending the round on a dead board", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  const dead = deadBoard();
  assertEqual(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );
  assertEqual(hasAnyRun(dead), false, "a maximal run on the dead board");
  assertEqual(legalSwapExists(dead), false, "a legal swap on the dead board");

  await loadBoard(h, posed);

  const after = await captureReplay(h, "levelup", async () => {
    const first = await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
    assertEqual(first.phase, "resolving", "the phase step 1 resolved into");

    // Both conditions are now standing at once: nothing on the board can be
    // played, and the level's target has been met — the target the round itself
    // reports, read here rather than reckoned.
    await writeBoard(dead);
    const standing = await h.snapshot();
    assertEqual(standing.level, 1, "the level the round is on");
    assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
    await h.debug.setLevelScore(standing.levelTarget);
    const held = await h.snapshot();
    assertEqual(held.phase, "resolving", "the phase the poses left standing");
    assertEqual(
      held.levelScore,
      standing.levelTarget,
      "the level score posed at the target the round reports",
    );

    await advanceStep(h);
    return h.snapshot();
  });

  assertEqual(after.phase, "idle", "the phase the chain ended in");
  assertEqual(
    after.screen,
    "levelclear",
    "the screen the met target opened, against the gameover a dead board alone " +
      "would have reached",
  );
  assertEqual(after.menuIndex, 0, "the highlighted item on arriving");
  assertEqual(after.level, 1, "the level the met target left standing");

  // Nothing was dealt over it. The level's own deal belongs to CONTINUE, so the
  // board the round was won on is the board the screen was raised on — and it is
  // still the dead one, which is what makes the order of the two conditions the
  // only thing this reading could have turned on.
  const board = await h.board();
  assertEqual(
    legalSwapExists(board),
    false,
    "a legal swap on the board the level was cleared from",
  );
  assertEqual(hasAnyRun(board), false, "a maximal run on that same board");
});
