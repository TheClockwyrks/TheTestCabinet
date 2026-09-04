// Facet — screens/levelclear-back-does-nothing: the level-clear screen refuses
// the key that backs out of every other screen.
//
// specs/ui.md says it plainly of `levelclear`: "`back` does nothing here, so the
// screen is left by taking one of its two items." specs/controls.md says the
// same from the other side, as the whole of what the action is for: "`back` —
// Leaves `howto` and `gameover`", and "`back` acts on `howto` and `gameover` and
// nowhere else."
//
// THIS IS THE NEGATIVE HALF OF THE BINDING TABLE. Every other point about `back`
// asks that a screen it acts on is left; this one asks that a screen it does not
// act on is NOT. A build that wired the action to every screen answers all of
// them and fails only here — and what it costs a player is the choice this
// screen exists to offer: a level just won is backed out of, and `CONTINUE`,
// which is the only thing that opens the next level, is never taken.
//
// THE KEY IS REAL, AND IT IS THE AMBIGUOUS ONE ON PURPOSE. specs/controls.md
// binds `back` to `Escape` and binds `Escape` to `pause` as well, keeping the
// two apart by screen: `pause` acts on `playing` and `paused` and nowhere else,
// `back` on `howto` and `gameover` and nowhere else. `levelclear` is a screen
// NEITHER acts on, so one press of the key both actions share decides both
// negatives at once — and a build that routed the key to either action on every
// screen is caught by it.
//
// THE MENU IS READ RATHER THAN ASSUMED. specs/ui.md puts `menuIndex` at `0` on
// arriving at this screen, and what the press must leave is the menu "where it
// was", so the index is recorded before the press and compared with itself
// after. A frame is advanced after the press because the actions are read once
// per frame as press edges (specs/controls.md), so a build that acts on the key
// acts on the frame that follows it — and a check that read the state before
// that frame would find the screen standing whatever the build did with it.
//
// HOW THE SCREEN IS REACHED. A swap is accepted on a posed board and carried
// into step 1; while that step still holds, the board it will next be read
// against is written under it with `setGem`, which specs/instrumentation.md says
// leaves the screen and the phase where they were, and `levelScore` is posed at
// the target the round reports. That board carries a legal swap, so the settled
// board meets the level condition and nothing else — which screen a build raises
// when a board is both complete and dead is `levels/level-before-gameover`'s
// point, and this check keeps clear of it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the level-clear screen standing, with its menu and its board untouched, on the back key", async () => {
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
  const standing = await h.snapshot();
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  await h.debug.setLevelScore(standing.levelTarget);

  await advanceStep(h);

  const cleared = await h.snapshot();
  const clearedBoard = await h.board();
  assertEqual(cleared.screen, "levelclear", "the screen back is pressed on");
  assertEqual(cleared.menuIndex, 0, "the highlighted item on arriving");
  assertLength(
    cleared.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the finished board the screen shows",
  );

  await h.tapAction("back");
  // One frame past the press, because an action is read once per frame as an
  // edge: a build that acts on the key acts on this frame.
  await h.advance(1);

  const after = await h.snapshot();
  await captureStill(h, "standing");
  assertEqual(after.screen, "levelclear", "the screen the back key leaves");
  assertEqual(after.menuIndex, cleared.menuIndex, "the menu across the press");
  assertBoardEquals(
    await h.board(),
    clearedBoard,
    "the board across the press",
  );
  assertEqual(after.level, cleared.level, "the level across the press");
  assertEqual(
    after.levelScore,
    cleared.levelScore,
    "levelScore across the press",
  );
});
