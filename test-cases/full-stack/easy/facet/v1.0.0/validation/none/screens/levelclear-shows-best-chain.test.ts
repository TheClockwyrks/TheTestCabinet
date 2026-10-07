// Facet — screens/levelclear-shows-best-chain: the level-clear screen reports
// the deepest chain the level reached.
//
// specs/ui.md gives `levelclear` two readouts and names each one: "Longest chain
// — BEST_CHAIN_LABEL (`LONGEST CHAIN`) — `state.bestChain`, the deepest chain
// step the level reached." specs/rules.md is what puts a figure in that field:
// `bestChain` "is the deepest `chainStep` any chain has reached in the current
// level", taken at each step and returned to `0` when a level is opened. The
// screen is where the level is totted up, so a build that keeps the figure and
// never draws it has measured the level and told the player nothing.
//
// IT IS A SEPARATE POINT FROM THE BEST-MOVE READOUT because specs/ui.md gives
// the screen two readouts and a build can draw one of them: they are two
// labels, two fields, and two chances to forget one.
//
// THE FIGURE IS POSED, NOT EARNED, and that is what makes the reading
// unambiguous. A chain deep enough to give a distinctive two-digit number cannot
// be posed onto a board — a chain runs as deep as the refill happens to carry it
// — so `setBestChain` writes the figure the screen is then asked to show.
// Whether the figure is TRACKED correctly as a chain runs is
// `scoring/best-chain-tracks-the-level`'s point, and a build that tracks it
// wrongly owes that point rather than this one as well.
//
// IT IS POSED ON THE SCREEN ITSELF rather than before the chain that opens it.
// specs/rules.md has each step set `bestChain` to the greater of itself and
// `chainStep`, so a figure written before the level ends is a figure the level's
// own last move can still raise; written once the screen stands, it is exactly
// the figure the frame is asked for. specs/instrumentation.md allows it:
// `setBestChain` "sets `bestChain` ... Nothing else changes."
//
// WHY 27, AND WHY THE OTHER FIGURES ARE POSED TOO. specs/ui.md fixes each
// readout's label and the field it shows and fixes no numeric format, and
// `frameShows` spans the whole frame's text, so the figure under test
// has to be one no other readout on the screen could be built from. The level is
// posed at `4`, whose target is `8000`, and the level score is posed at that
// target; the score and the best move are posed to `0`. `27` shares no digit
// with `4`, `8000` or `0`, so a `2` or a `7` anywhere on the frame came from
// this readout and from nothing else.
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
import { BEST_CHAIN_LABEL, GRID_COLS, GRID_ROWS } from "../constants";
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
  frameShows,
  loadBoard,
  shownText,
  swapAndStep,
  writeBoard,
  type FrameText,
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

/** The level finished, whose target (`8000`) carries no `2` and no `7`. */
const FINISHED_LEVEL = 4;

/** The longest chain the screen is asked to report. */
const POSED_BEST_CHAIN = 27;

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually showed.
 */
function requireCopy(frame: FrameText, wanted: string): void {
  if (!frameShows(frame, wanted)) {
    fail(
      `the level-clear screen to show ${JSON.stringify(wanted)}`,
      shownText(frame),
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the longest-chain label and the level's longest chain", async () => {
  const posed = quietRowsWith(TRIGGER);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(maximalRuns(SETTLED), 0, "maximal runs on the settled board");
  assertGreaterThan(
    legalSwaps(SETTLED).length,
    0,
    "legal swaps on the settled board",
  );

  await loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.phase, "resolving", "the phase the accepted swap opened");

  await writeBoard(h, SETTLED);
  assertBoardEquals(
    await h.board(),
    SETTLED,
    "the board the step is read against",
  );
  await h.debug.setLevel(FINISHED_LEVEL);

  const standing = await h.snapshot();
  assertEqual(standing.level, FINISHED_LEVEL, "the level being finished");
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  await h.debug.setLevelScore(standing.levelTarget);

  await advanceStep(h);
  assertEqual(
    (await h.snapshot()).screen,
    "levelclear",
    "the screen the met target reaches",
  );

  // The figure under test, and the figures around it posed so nothing else on
  // the frame can be built from a `2` or a `7`.
  await h.debug.setBestChain(POSED_BEST_CHAIN);
  await h.debug.setBestMove(0);
  await h.debug.setScore(0);

  const cleared = await h.snapshot();
  assertEqual(
    cleared.screen,
    "levelclear",
    "the screen the poses left standing",
  );
  assertEqual(cleared.bestChain, POSED_BEST_CHAIN, "the posed longest chain");
  assertEqual(cleared.bestMove, 0, "the posed best move");
  assertEqual(cleared.score, 0, "the posed score");
  assertLength(
    cleared.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the finished board behind the menu",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const frame = await h.frameText();
  await captureStill(h, "levelclear");

  requireCopy(frame, BEST_CHAIN_LABEL);
  requireCopy(frame, String(POSED_BEST_CHAIN));
});
