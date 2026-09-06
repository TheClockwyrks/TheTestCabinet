// growth/first-pellet-off-start-chain — the first pellet of a round is valid.
//
// specs/board.md: "The first pellet of a round is placed after the snake is laid
// at its starting cells, so it never lands under the starting chain." That is an
// ORDERING requirement written as an outcome, and the outcome is what is read: an
// interior cell that is none of the three cells specs/board.md lays the chain on.
//
// THE DRAW IS POSED RATHER THAN SAMPLED. A build that draws the pellet before
// laying the snake lands under the chain once in every hundred and fifty rounds
// or so, which no honest number of opened rounds separates from luck. So the
// spawn is posed onto a starting cell with `setNextPellet`, which
// specs/instrumentation.md makes "the first pellet a fresh round lays" honor
// "when the cell is in the valid set specs/board.md defines at that moment" and
// discard otherwise. A build that lays the chain first finds the cell under it
// and draws elsewhere; a build that draws first finds it free and puts the
// pellet under the chain it then lays. The chain is moved off its starting cells
// before the round opens, because after a reset it already stands on them and
// either order would exclude the posed cell.
//
// WHY THIS POINT PRESSES A KEY. A fresh round is laid out by starting one, and
// specs/instrumentation.md is explicit that `setScreen("playing")` does not do
// that: it "runs the tick over the board as it stands rather than laying out a
// fresh round". So the only way to reach the thing under test is the title menu's
// first item, which specs/ui.md makes the mode's own entry. Each starting cell is
// posed in turn, because a build might lay the head before the body.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { START_CELLS, type Cell } from "../constants";
import {
  captureStill,
  chainFrom,
  chooseItem,
  createHarness,
  holdsCell,
  isInterior,
  type Harness,
} from "../harness";

/**
 * Where the chain stands while the round is opened: on the starting row, which
 * specs/mode.md keeps clear of every course, and well clear of the starting cells.
 */
const PARKED_HEAD: Cell = { col: 5, row: START_CELLS[0].row };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens every round with its pellet clear of the starting chain", async () => {
  for (const [index, cell] of START_CELLS.entries()) {
    await h.debug.reset();
    await h.debug.setSnake(chainFrom(PARKED_HEAD, "right", 3));
    await h.debug.setNextPellet(cell.col, cell.row);
    await chooseItem(h, 0);
    const opened = await h.snapshot();
    if (index === 0) {
      // The round the reading is taken off, kept as the point's evidence.
      await captureStill(h, "first");
    }

    const posed = `(${cell.col}, ${cell.row}) posed as the first pellet`;
    assertEqual(opened.screen, "playing", `the round opened with ${posed}`);
    assertNotNull(opened.pellet, `the first pellet with ${posed}`);
    const pellet = opened.pellet as Cell;
    assertEqual(
      isInterior(pellet.col, pellet.row),
      true,
      `the first pellet with ${posed} on an interior cell`,
    );
    assertEqual(
      holdsCell(START_CELLS, pellet),
      false,
      `the first pellet with ${posed} clear of the starting chain`,
    );
  }
});
