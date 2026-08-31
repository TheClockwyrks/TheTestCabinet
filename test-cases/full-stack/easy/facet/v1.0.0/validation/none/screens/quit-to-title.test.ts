// Facet — screens/quit-to-title: QUIT abandons the round and leaves nothing of
// it behind.
//
// specs/ui.md puts the same entry in two menus. On `paused`: "`QUIT` — Sets
// `screen = title` and `menuIndex = 0`, abandoning the round." On `gameover`:
// "`QUIT` — Sets `screen = title` and `menuIndex = 0`."
// specs/instrumentation.md then says what abandoning the round leaves: "the
// screen becomes `title` with its first menu item highlighted, no board is in
// play, `phase` is `idle` with `chainStep` and `stepTimer` at `0`, and there is
// no selection and no refusal."
//
// THAT LAST HALF IS THE POINT. Reaching the title is easy; leaving nothing of
// the round behind is the part a build gets wrong, because the title screen
// draws none of it. specs/instrumentation.md fixes the resting values a snapshot
// reports when there is nothing to report — `board` is `{ cols: 0, rows: 0,
// cells: [] }` while no board is in play — so a build that walked away from a
// live board without putting it down reports it here.
//
// THE POSE IS THE ROUTE, AND IT COVERS BOTH MENUS. specs/instrumentation.md
// defines `quit()` as "the choice of `QUIT`, which the pause menu and the
// game-over menu both offer", so one pose decides both entries and neither
// menu's ordering enters a verdict about the state QUIT leaves. It is taken from
// each of the two screens in turn, because the sentence is about both.
//
// THE ROUND IS DIRTIED FIRST. A quit from a round that had nothing running would
// pass on a build that clears nothing, so the first round is quit mid-chain with
// a step timer part way through a step and a cell selected, and each of those is
// read back before the quit so the resting values afterwards are known to be the
// quit clearing them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS, STEP_DRIVE_FRAMES } from "../constants";
import {
  assertBoardEquals,
  deadBoard,
  legalSwaps,
  maximalRuns,
  quietRowsWith,
  quietRowsWithEscape,
  swapIsLegal,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The run a swap makes, so a chain is running when the round is left. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** Frames of the step spent before the round is left, so the timer is running. */
const FRAMES_INTO_STEP = 5;

/** The cell selected before the round is left, so a selection stands. */
const SELECTED: CellRef = { col: 2, row: 3 };

let h: Harness;

/** Every resting value specs/instrumentation.md fixes for the state QUIT leaves. */
function assertRestingTitle(state: FacetSnapshot, which: string): void {
  assertEqual(state.screen, "title", `${which}: the screen QUIT leaves`);
  assertEqual(state.menuIndex, 0, `${which}: the highlighted title item`);
  // "no board is in play" — the resting board a snapshot reports for one.
  assertEqual(state.board.cols, 0, `${which}: columns of the board in play`);
  assertEqual(state.board.rows, 0, `${which}: rows of the board in play`);
  assertLength(state.board.cells, 0, `${which}: cells of the board in play`);
  assertEqual(state.phase, "idle", `${which}: phase`);
  assertEqual(state.chainStep, 0, `${which}: chainStep`);
  assertEqual(state.stepTimer, 0, `${which}: stepTimer`);
  assertEqual(state.selection, null, `${which}: selection`);
  assertEqual(state.refusal, null, `${which}: refusal`);
}

/**
 * Drive a round to its end, and read the game-over it settles into.
 *
 * specs/rules.md ends a round "when `phase` returns to `idle` and no legal swap
 * exists on the board", so a chain is opened and the board it will be read
 * against is written under it with `setGem`, which specs/instrumentation.md says
 * leaves the screen, the phase, the cursor and the selection where they were.
 * `deadBoard()` carries no run under R4 and no adjacent exchange R1 and R3 both
 * accept, and both are asserted here rather than assumed, so when the step's
 * time is spent the board seeds nothing, the chain returns to idle, and the
 * round has nowhere left to go.
 */
async function driveToGameOver(h: Harness): Promise<FacetSnapshot> {
  const posed = quietRowsWith(TRIGGER);
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  await loadBoard(h, posed);
  assertEqual((await swap(h, SWAP_A, SWAP_B)).phase, "resolving", "the phase");

  const dead = deadBoard();
  assertLength(maximalRuns(dead), 0, "maximal runs on the dead board");
  assertLength(legalSwaps(dead), 0, "legal swaps on the dead board");
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      await h.debug.setGem(col, row, tokenAt(dead, col, row));
    }
  }
  assertBoardEquals(await h.board(), dead, "the board the step is read against");

  await h.advance(STEP_DRIVE_FRAMES);
  return h.snapshot();
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with nothing of the round left, from the pause menu and from game over", async () => {
  // A round with something running in it: a chain part way through a step, and
  // a cell selected.
  await loadBoard(h, quietRowsWithEscape(TRIGGER));
  await swap(h, SWAP_A, SWAP_B);
  await h.advance(FRAMES_INTO_STEP);
  await h.debug.setSelection(SELECTED.col, SELECTED.row);

  const running = await h.snapshot();
  assertEqual(running.chainStep, 1, "the chain step the round is left during");
  assertGreaterThan(running.stepTimer, 0, "the step timer the round is left at");
  assertNotNull(running.selection, "the selection the round is left holding");
  assertEqual(running.board.cells.length, GRID_COLS * GRID_ROWS, "cells in play");

  await h.debug.pause();
  assertEqual((await h.snapshot()).screen, "paused", "the screen QUIT is taken from");
  // The highlight is moved off the first item where the build's menu answers to
  // it, so `menuIndex` reading 0 on the title is the quit setting it rather than
  // it never having moved. Nothing is asserted of the move: which item the
  // highlight lands on is the menus' own point, not this one.
  await h.tapAction("down");

  await h.debug.quit();
  await h.advance(1);
  await captureStill(h, "title");
  assertRestingTitle(await h.snapshot(), "quitting from the pause menu");

  // And the same entry on the other menu that offers it.
  const over = await driveToGameOver(h);
  assertEqual(over.screen, "gameover", "the screen QUIT is taken from");
  assertEqual(over.board.cells.length, GRID_COLS * GRID_ROWS, "cells in play");
  await h.tapAction("down");

  await h.debug.quit();
  assertRestingTitle(await h.snapshot(), "quitting from the game-over menu");
});
