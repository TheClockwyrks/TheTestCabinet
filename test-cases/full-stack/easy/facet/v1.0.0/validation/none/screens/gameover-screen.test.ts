// Facet — screens/gameover-screen: the end of a round is a screen a player can
// read.
//
// specs/ui.md gives `gameover` its heading GAMEOVER_TITLE_TEXT (`NO MOVES
// LEFT`), the two entries of GAMEOVER_ITEMS (`PLAY AGAIN`, `QUIT`), and one more
// sentence: "The screen also shows the round's final `state.score` and the
// `state.level` it reached." `menuIndex` is `0` on arriving. So the screen has
// to say why the round stopped, what the round was worth, and what the player
// may do next — a build that reaches the state without drawing it leaves a
// player looking at a dead board with no way to read the result or start again.
//
// HOW THE ROUND IS ENDED. specs/rules.md ends it "when `phase` returns to `idle`
// and no legal swap exists on the board", so a chain is opened with a swap and
// the board that chain will next be read against is written under it with
// `setGem`, which specs/instrumentation.md says leaves the screen, the phase,
// the cursor and the selection exactly where they were. `deadBoard()` carries no
// run under R4 and no adjacent exchange R1 and R3 both accept — both asserted
// here rather than assumed — so once the step's time is spent the board seeds
// nothing, the chain returns to idle, and the round is over.
//
// THE TWO FIGURES ARE POSED, so what the screen owes is known rather than
// computed. `setScore` and `setLevel` are the poses specs/instrumentation.md
// gives for exactly that, and both are read back off the snapshot before the
// frame is drawn, so the strings looked for are the figures the game itself
// holds. FINAL_SCORE is under a thousand and FINAL_LEVEL is two digits: the
// first because specs/ fixes no grouping for a large number and a build is free
// to write one, the second so the needle is not a lone digit that any readout
// could answer for.
//
// The copy is read through `frameText`, which gathers a frame's canvas text and
// the page's own DOM text alike, because specs/assets.md has an engineless build
// draw its chrome "in code (canvas or DOM)" and this point is not about which of
// the two it chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue, fail } from "../assert";
import {
  GAMEOVER_ITEMS,
  GAMEOVER_TITLE_TEXT,
  GRID_COLS,
  GRID_ROWS,
  STEP_DRIVE_FRAMES,
} from "../constants";
import {
  assertBoardEquals,
  deadBoard,
  legalSwaps,
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  showsText,
  swap,
  type Harness,
} from "../harness";

/** The run a swap makes, so a chain is running when the dead board is written. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** The score the round ends on. Under a thousand, so no grouping is at issue. */
const FINAL_SCORE = 730;

/** The level the round ends on. Two digits, so the needle is not a lone digit. */
const FINAL_LEVEL = 12;

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually drew.
 */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the game-over screen to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the round on the game-over screen, showing its copy, its score and its level", async () => {
  const posed = quietRowsWith(TRIGGER);
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  await loadBoard(h, posed);
  assertEqual((await swap(h, SWAP_A, SWAP_B)).phase, "resolving", "the phase");

  // The round's final figures, banked while the step is still holding.
  await h.debug.setScore(FINAL_SCORE);
  await h.debug.setLevel(FINAL_LEVEL);

  // The board the holding step will be read against: no run to seed a further
  // step, and no legal swap to carry the round on.
  const dead = deadBoard();
  assertLength(maximalRuns(dead), 0, "maximal runs on the dead board");
  assertLength(legalSwaps(dead), 0, "legal swaps on the dead board");
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      await h.debug.setGem(col, row, tokenAt(dead, col, row));
    }
  }
  assertBoardEquals(await h.board(), dead, "the board the step is read against");

  // Past `STEP_SECONDS`, so the board is read again, seeds nothing, and the
  // chain returns to idle — where specs/rules.md evaluates the end of a round.
  await h.advance(STEP_DRIVE_FRAMES);

  const over = await h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the settled round reaches");
  assertEqual(over.menuIndex, 0, "the highlighted item on arriving");
  assertEqual(over.score, FINAL_SCORE, "the score the round ended on");
  assertEqual(over.level, FINAL_LEVEL, "the level the round ended on");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "gameover");

  requireCopy(drawn, GAMEOVER_TITLE_TEXT);
  // Both entries, each on its own: `showsText` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of GAMEOVER_ITEMS) requireCopy(drawn, item);
  requireCopy(drawn, String(FINAL_SCORE));
  requireCopy(drawn, String(FINAL_LEVEL));
});
