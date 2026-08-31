// levels/level-score-carries — a level change zeroes `levelScore` and leaves
// `score` alone.
//
// specs/rules.md ends the level rule with three words this point is entirely
// about: "`score` carries across." `levelScore` is the figure banked toward one
// level's target and it goes back to `0` when that level is done; `score` is what
// the round has earned since it began, and a level change is not allowed to touch
// it.
//
// THE SCENARIO NEEDS THE ROUND TO HAVE EARNED SOMETHING, AND THEN READS IT. The
// round is posed carrying a score already, the level score is posed at the target
// the round is playing to, and exactly ONE scoring step is driven. What that step
// was worth is `scoring/score-base-rate`'s claim and no part of this one, so the
// figure is not reckoned from a rate: the score the step LEFT is read off the
// running chain, and the requirement is that the same figure is still standing
// after the level has turned over. A build that priced the step wrongly carries
// its own figure across and passes here, owing the point that owns the rate; a
// build that zeroes the round's score with the level's fails, whatever the step
// was worth.
//
// ONLY ONE STEP MAY SCORE, or the figure read on the running chain would not be
// the figure the level change was handed. The board is rewritten under the
// running step to one carrying no run at all, so the read that follows
// STEP_SECONDS seeds nothing, the chain ends there, and no cascade off R9's
// seeded refill can add points between the two readings. `setGem` is what
// rewrites it: specs/instrumentation.md says it writes one cell and leaves "the
// screen, the phase, the cursor, and the selection" standing, so the step keeps
// holding and reads the rewritten board when its time is up.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`:
// what the target ought to be is `levels/level-target-derived`'s point, and this
// one only needs a level that turns over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  hasAnyRun,
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
  swap,
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

/** What the round is posed as having earned before the level in question. */
const POSED_SCORE = 5000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Write every cell of a board in the notation onto the live board, `setGem` by `setGem`. */
function writeBoard(rows: BoardRows): void {
  // Parsed on this side first, so a typo in the fixture fails here rather than
  // crossing into the build one cell at a time.
  parseRows(rows);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      h.debug.setGem(col, row, tokenAt(rows, col, row));
    }
  }
}

it("keeps the round's score through the level change that zeroes the level score", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  const quiet = quietRowsWithEscape([]);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertEqual(hasAnyRun(quiet), false, "a maximal run on the rewritten board");
  assertEqual(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );

  loadBoard(h, posed);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLevel(1);

  // The target the round is playing to, read rather than reckoned.
  const opened = h.snapshot();
  assertEqual(opened.level, 1, "the level the round stands at");
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  h.debug.setLevelScore(opened.levelTarget);

  const driven = await captureReplay(h, "levelup", async () => {
    const first = swap(h, RUN_SWAP.a, RUN_SWAP.b);
    assertEqual(first.phase, "resolving", "the phase the accepted swap opened");

    // Nothing more may score: the step now holds a board with no run on it, so
    // the read at STEP_SECONDS seeds nothing and the chain ends.
    writeBoard(quiet);
    await advanceStep(h);
    return { earned: first.score, settled: h.snapshot() };
  });

  const { earned, settled: after } = driven;

  // The round really did earn something on the step, so what crosses the level
  // change is a figure the round moved rather than the one it was posed with.
  assertGreaterThan(
    earned,
    POSED_SCORE,
    `the score the step left, against the ${POSED_SCORE} the round was posed at`,
  );

  assertEqual(after.phase, "idle", "the phase the chain ended in");
  assertEqual(after.level, 2, "the level the completed target opened");
  assertEqual(after.levelScore, 0, "the level score after the level rose");
  assertEqual(
    after.score,
    earned,
    "the score carried across the level change, against the score the step left",
  );
});
