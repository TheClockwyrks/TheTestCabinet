// ruleset/r9-solved — R9: the board is solved on the final permitted move of
// a known solution, and the game leaves playing on that same call.
//
// The board is the R9_UNIQUE fixture — a snake whose solution is forced up to
// direction, T(0,0)-t(0,1)-t(1,1)-t(2,1)-T(3,2) — so the suite knows exactly
// which move is the final one. The route is driven move by move through the
// surface's pointer operations, which take effect the moment they are called
// (specs/instrumentation.md), so `solved` is read after every single move:
//
//   - after every move before the last, `solved` is false and the screen is
//     still `playing` — the board reads as solved EXACTLY when every channel
//     present has a complete beam and every crystal is satisfied, not before;
//   - on the final move, `solved` flips true in the state that very call
//     returns, the beam reports complete, and the screen has left `playing`
//     ("a move that satisfies R9 solves the board and ends the trace on the
//     spot", specs/instrumentation.md; R9 is evaluated after every change,
//     specs/beams.md).
//
// The board carries no crystal; that half of R9's reading is held by
// ruleset/r8-crystals, which shows an unsatisfied crystal keeping `solved`
// false with the beams complete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";

/** R9_UNIQUE is `T... / ttt. / ...T`: 4 columns, 3 rows. */
const COLS = 4;
const ROWS = 3;

/** The forced solution, in drawn order. */
const SOLUTION: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h);
  await loadBoard(h, R9_UNIQUE);
});

afterEach(() => {
  h?.dispose();
});

it("flips solved true and leaves playing on the final permitted move", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  const [start, ...moves] = SOLUTION;
  h.debug.pointerDown(at(start[0], start[1]).x, at(start[0], start[1]).y);

  // Every move before the last leaves the board unsolved, on playing.
  for (const [col, row] of moves.slice(0, -1)) {
    h.debug.pointerMove(at(col, row).x, at(col, row).y);
    const partial = h.snapshot();
    assertEqual(
      partial.solved,
      false,
      `solved stays false with the beam drawn through (${col}, ${row}) — ` +
        "the board reads as solved exactly when R6, R7, and R8 all hold " +
        "(specs/beams.md R9)",
    );
    assertEqual(
      partial.screen,
      "playing",
      `the game stays on playing with the beam drawn through (${col}, ${row})`,
    );
  }

  // The final permitted move: solved flips true on this same call.
  const [lastCol, lastRow] = SOLUTION[SOLUTION.length - 1];
  h.debug.pointerMove(at(lastCol, lastRow).x, at(lastCol, lastRow).y);
  const solved = h.snapshot();
  assertEqual(
    solved.solved,
    true,
    "R9: solved flips true on the final permitted move of the known " +
      "solution (specs/beams.md)",
  );
  assertEqual(
    solved.beams.triangle?.complete,
    true,
    "the solving move is the one that completes the channel's beam " +
      "(specs/beams.md R6, R7)",
  );
  assertNotEqual(
    solved.screen,
    "playing",
    "the game leaves playing on that same call (specs/beams.md R9 is " +
      "evaluated after every change)",
  );

  // Evidence: the board on its solving move.
  await h.advance(1);
  captureStill(h, "solved");

  h.debug.pointerUp();
});
