// Facet — screens/levelclear-screen: finishing a level opens a screen of its
// own, and it is a screen a player can read.
//
// specs/rules.md ends a level the moment a chain settles with the target met:
// "When `phase` returns to `idle` and `levelScore` is at or past the target, the
// level is over: `screen` becomes `levelclear` with `menuIndex` at `0`."
// specs/ui.md then gives that screen its heading LEVELCLEAR_TITLE_TEXT (`LEVEL
// CLEAR`), the two entries of LEVELCLEAR_ITEMS (`CONTINUE`, `QUIT`), and "the
// level just finished, `state.level`". So the screen has to say what was
// finished and what the player may do next.
//
// WHY THIS IS CAPPED AT `broken`. A build that never raises this screen has no
// route past its first level: the round simply keeps playing on a board it has
// already won, and no amount of further play can open the next level, because
// `CONTINUE` is the only thing that opens one.
//
// WHAT THE SCREEN DRAWS IS THIS POINT; WHAT ITS TWO ITEMS DO IS THE `levels`
// CATEGORY'S. A build can raise the right screen and open the next level
// wrongly, or the other way about, so the two are separable faults and are
// separate points.
//
// HOW THE SCREEN IS REACHED. A swap is accepted on a posed board and carried
// through the swap animation into step 1. While that step still holds, the board
// it will next be read against is written under it with `setGem`, which
// specs/instrumentation.md says leaves the screen and the phase where they were,
// and `levelScore` is posed at the target the ROUND reports — what that figure
// ought to be is `levels/level-target-derived`'s point, not this one's. When the
// step's hold is spent the board seeds nothing, `phase` returns to `idle`, and
// the level condition is evaluated on a level that has been met.
//
// THE BOARD WRITTEN UNDER THE STEP CARRIES A LEGAL SWAP, and that is deliberate:
// a board with none would meet the end-of-round condition at the same moment,
// and which screen a build then raises is `levels/level-before-gameover`'s
// point. Written this way, `levelclear` is the only screen the settled board can
// reach, so a failure here is this point's.
//
// THE FIGURES BESIDE THE LEVEL ARE POSED TO ZERO once the screen stands, so the
// digits of the level are the only ones of their value that can be on the frame.
// specs/ui.md fixes each readout's label and the state field it shows and fixes
// no numeric format, and `showsText` searches the frame's whole run of text, so
// a stray figure sharing the level's digits could answer for it. LEVEL is posed
// two-digit for the same reason — a lone digit is a needle any readout could
// answer for — and `13` shares no digit run with the `26000` its target and its
// level score are built from. Posing on the screen itself is what
// specs/instrumentation.md allows: `setScore`, `setBestChain` and `setBestMove`
// each change nothing but their own figure.
//
// The copy is read through `frameText`, which hands back every string one frame
// put on screen, and `showsText` decides whether a string is among them across
// every shape specs/ui.md leaves open — one call per line, one per word, one per
// glyph, or a figure drawn beside its label in a single run.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import {
  GRID_COLS,
  GRID_ROWS,
  LEVELCLEAR_ITEMS,
  LEVELCLEAR_TITLE_TEXT,
} from "../constants";
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

/** The level finished. Two digits, so the needle is not a lone digit. */
const FINISHED_LEVEL = 13;

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

it("opens the level-clear screen on the level's target, showing its copy and the level", async () => {
  const posed = quietRowsWith(TRIGGER);
  // The fixture's own guarantees, so anything that fails below is the build's.
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

  // The board the holding step will read, and the level it will be read on.
  writeBoard(h, SETTLED);
  assertBoardEquals(h.board(), SETTLED, "the board the step is read against");
  h.debug.setLevel(FINISHED_LEVEL);

  // The target the round itself reports, posed as the level score exactly, so
  // the level is met and nothing further is banked into it.
  const standing = h.snapshot();
  assertEqual(standing.level, FINISHED_LEVEL, "the level being finished");
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  h.debug.setLevelScore(standing.levelTarget);

  await advanceStep(h);

  const cleared = h.snapshot();
  assertEqual(cleared.phase, "idle", "the phase the chain ended in");
  assertEqual(
    cleared.screen,
    "levelclear",
    "the screen the met target reaches",
  );
  assertEqual(cleared.menuIndex, 0, "the highlighted item on arriving");
  assertEqual(cleared.level, FINISHED_LEVEL, "the level the screen reports");
  assertLength(
    cleared.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the finished board behind the menu",
  );

  // The other figures the screen carries, posed to zero so the level's digits
  // are the only ones of their value the frame can be built from.
  h.debug.setScore(0);
  h.debug.setBestChain(0);
  h.debug.setBestMove(0);
  const quiet = h.snapshot();
  assertEqual(quiet.score, 0, "the posed score");
  assertEqual(quiet.bestChain, 0, "the posed longest chain");
  assertEqual(quiet.bestMove, 0, "the posed best move");
  assertEqual(quiet.screen, "levelclear", "the screen the poses left standing");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  captureStill(h, "levelclear");

  requireCopy(drawn, LEVELCLEAR_TITLE_TEXT);
  // Both entries, each on its own: `showsText` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of LEVELCLEAR_ITEMS) requireCopy(drawn, item);
  requireCopy(drawn, String(FINISHED_LEVEL));
});
