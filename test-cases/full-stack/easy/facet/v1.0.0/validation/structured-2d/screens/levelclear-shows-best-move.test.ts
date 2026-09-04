// Facet — screens/levelclear-shows-best-move: the level-clear screen reports the
// most one move was worth.
//
// specs/ui.md gives `levelclear` two readouts and names each one: "Best move —
// BEST_MOVE_LABEL (`BEST MOVE`) — `state.bestMove`, the most points one move
// scored in the level." specs/rules.md is what puts a figure in that field: a
// move is "one accepted swap together with the whole chain it sets off", and
// when `phase` returns to `idle` "`bestMove` becomes the greater of itself and
// `moveScore`", returning to `0` when a level is opened. The screen is where the
// level is totted up, so a build that keeps the figure and never draws it has
// measured the level and told the player nothing.
//
// IT IS A SEPARATE POINT FROM THE LONGEST-CHAIN READOUT because specs/ui.md
// gives the screen two readouts and a build can draw one of them: they are two
// labels, two fields, and two chances to forget one.
//
// THE FIGURE IS POSED, NOT EARNED. What one move is worth depends on the clear
// set the chain happened to reach, so a distinctive three-digit figure cannot be
// arranged on a board; `setBestMove` writes it instead. Whether the figure is
// TRACKED correctly across a move is `scoring/best-move-tracks-the-level`'s
// point, and a build that tracks it wrongly owes that point rather than this one
// as well.
//
// IT IS POSED ON THE SCREEN ITSELF rather than before the chain that opens it.
// specs/rules.md takes `bestMove` as the greater of itself and `moveScore` at
// the moment the chain settles, which is the very moment this screen is reached,
// so a figure written before then is one the level's own last move can still
// raise. Written once the screen stands, it is exactly the figure the frame is
// asked for, and specs/instrumentation.md allows it: `setBestMove` "sets
// `bestMove` to `points`. Nothing else changes."
//
// WHY 561, AND WHY THE OTHER FIGURES ARE POSED TOO. Three digits, so no
// thousands separator a build is free to write can fall inside the figure and
// hide it from the reading. specs/ui.md fixes each readout's label and the field
// it shows and fixes no numeric format, and `showsText` searches the frame's
// whole run of text, so the figure under test has to be one no other readout on
// the screen could be built from: the score is posed to `0`, the level to `4`
// with its target and level score at `8000`, and the longest chain beside it to
// `27`. `561` shares no digit with any of them, so a `5`, a `6` or a `1`
// anywhere on the frame came from this readout and from nothing else.
//
// HOW THE SCREEN IS REACHED. A swap is accepted on a posed board and carried
// into step 1; while that step still holds, the board it will next be read
// against is written under it with `setGem` and `levelScore` is posed at the
// target the round reports. That board carries a legal swap, so the settled
// board meets the level condition and nothing else — which screen a build raises
// when a board is both complete and dead is `levels/level-before-gameover`'s
// point, and this check keeps clear of it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import { BEST_MOVE_LABEL, GRID_COLS, GRID_ROWS } from "../constants";
import {
  assertBoardEquals,
  legalSwaps,
  maximalRuns,
  quietRowsWith,
  quietRowsWithEscape,
  swapIsLegal,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureStill,
  createHarness,
  loadBoard,
  showsText,
  swapAndStep,
  writeBoard,
  type Harness,
} from "../harness";

/** Three rubies across row 4, parted by the amethyst the swap trades out. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/**
 * The board the holding step is read against: no maximal run, so the chain
 * settles there, and a legal swap, so the settled board meets the level
 * condition alone.
 */
const SETTLED: BoardRows = quietRowsWithEscape([]);

/** The level finished, whose target (`8000`) carries no `5`, `6` or `1`. */
const FINISHED_LEVEL = 4;

/** The longest chain drawn beside the figure under test. */
const POSED_BEST_CHAIN = 27;

/** The best move the screen is asked to report. */
const POSED_BEST_MOVE = 561;

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually drew.
 */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the level-clear screen to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the best-move label and the level's best move", async () => {
  const posed = quietRowsWith(TRIGGER);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(maximalRuns(SETTLED), 0, "maximal runs on the settled board");
  assertGreaterThan(
    legalSwaps(SETTLED).length,
    0,
    "legal swaps on the settled board",
  );

  loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.phase, "resolving", "the phase the accepted swap opened");

  writeBoard(h, SETTLED);
  assertBoardEquals(h.board(), SETTLED, "the board the step is read against");
  h.debug.setLevel(FINISHED_LEVEL);

  const standing = h.snapshot();
  assertEqual(standing.level, FINISHED_LEVEL, "the level being finished");
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  h.debug.setLevelScore(standing.levelTarget);

  await advanceStep(h);
  assertEqual(
    h.snapshot().screen,
    "levelclear",
    "the screen the met target reaches",
  );

  // The figure under test, and the figures around it posed so nothing else on
  // the frame can be built from a `5`, a `6` or a `1`.
  h.debug.setBestMove(POSED_BEST_MOVE);
  h.debug.setBestChain(POSED_BEST_CHAIN);
  h.debug.setScore(0);

  const cleared = h.snapshot();
  assertEqual(
    cleared.screen,
    "levelclear",
    "the screen the poses left standing",
  );
  assertEqual(cleared.bestMove, POSED_BEST_MOVE, "the posed best move");
  assertEqual(cleared.bestChain, POSED_BEST_CHAIN, "the posed longest chain");
  assertEqual(cleared.score, 0, "the posed score");
  assertLength(
    cleared.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the finished board behind the menu",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  captureStill(h, "levelclear");

  requireCopy(drawn, BEST_MOVE_LABEL);
  requireCopy(drawn, String(POSED_BEST_MOVE));
});
