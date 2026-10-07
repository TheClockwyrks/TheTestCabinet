// levels/continue-deals-a-falling-board — the board CONTINUE deals comes in from
// above the board, exactly as the board a round opens on does.
//
// specs/rules.md, of the opening board: "The whole board is dealt in from above,
// so a gem dealt into row `r` carries a `fell` of at least `r + 1`, exactly as a
// refilled gem does under R9. Which figure at or above that each dealt gem
// carries is the build's." specs/rules.md gives `CONTINUE` "a fresh opening
// board", so it is an opening board and that sentence is about it.
//
// A FLOOR, AND NEVER A FIGURE. The specification fixes only the least a dealt
// gem can have traveled, and hands anything above it to the build — a build that
// drops its board from two rows above the top, or from off the top of the stage,
// conforms. So `board.ts` expresses a refill's fall as `{ atLeast }` and this
// check asserts `fell >= row + 1` on all 64 cells and nothing tighter. An exact
// expectation here would fail a conforming build.
//
// WHY IT IS A POINT OF ITS OWN, BESIDE `board/opening-falls-in`. That point reads
// the same claim on the other route into a fresh deal, the one `PLAY` takes. A
// build can deal the round's first board through code that falls in and open a
// level through code that does not — the two are different call sites — so the
// claim is read once on each route.
//
// THE READING IS TAKEN ON THE FRAME THE CHOICE IS DELIVERED ON. `confirm` is
// taken by one frame and the deal happens inside it, so the board is read the
// moment it is dealt, while every gem still carries the fall it arrived with. A
// frame of game time would let the gems land and a build that reports the fall of
// the drop in motion would then read as having reported nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS, LEVELCLEAR_ITEMS } from "../constants";
import {
  assertFell,
  hasAnyRun,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  swapAndStep,
  takeMenuItem,
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

/**
 * Frames the replay runs on after the deal, so the kept recording shows the
 * board arriving rather than one motionless frame of it.
 *
 * Nothing is read off them: the reading this check makes is taken before the
 * first of them runs. `GRID_ROWS * FALL_SECONDS_PER_ROW` is `0.4` s, which is
 * longer than the deepest fall on the board can take, so the recording covers the
 * whole arrival at the suite's own frame size.
 */
const WATCH_FRAMES = 32;

/** Where `CONTINUE` sits on the level-clear menu, from specs/ui.md's `LEVELCLEAR_ITEMS`. */
const CONTINUE_INDEX = LEVELCLEAR_ITEMS.indexOf("CONTINUE");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals every gem in from above its row", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );

  loadBoard(h, posed);
  h.debug.setLevel(1);

  // The target the round is playing to, read rather than reckoned: what that
  // figure ought to be is `levels/level-target-derived`'s point.
  const opened = h.snapshot();
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  h.debug.setLevelScore(opened.levelTarget);

  const dealt = await captureReplay(h, "deal", async () => {
    await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
    const settled = await resolveChain(h);
    assertTrue(settled.settled, "the chain returned to idle within the cap");
    assertEqual(
      settled.snapshot.screen,
      "levelclear",
      "the screen the met target opened, which CONTINUE is offered from",
    );

    // The reading, taken at the pose and before any frame has run.
    // CONTINUE is really CHOSEN, which is what the item says: the highlight is
    // posed onto it — `setMenuIndex` takes no item — and `confirm` is what takes
    // it, through the key specs/controls.md binds and the build's own input path.
    await takeMenuItem(h, CONTINUE_INDEX);
    const reading = h.snapshot();
    await h.advance(WATCH_FRAMES);
    return reading;
  });

  assertEqual(dealt.screen, "playing", "the screen CONTINUE returns to");
  assertEqual(dealt.board.cols, GRID_COLS, "the columns of the dealt board");
  assertEqual(dealt.board.rows, GRID_ROWS, "the rows of the dealt board");
  assertLength(
    dealt.board.cells,
    GRID_COLS * GRID_ROWS,
    "the cells of the dealt board",
  );

  // Every one of the 64, held to the floor R9 and the opening board share and to
  // nothing above it.
  for (const cell of dealt.board.cells) {
    assertFell(
      cell.fell,
      { atLeast: cell.row + 1 },
      `the fell of the gem dealt into (${cell.col},${cell.row})`,
    );
  }
});
