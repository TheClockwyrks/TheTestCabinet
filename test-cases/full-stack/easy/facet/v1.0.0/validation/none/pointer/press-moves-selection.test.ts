// Facet — pointer/press-moves-selection: a press on a cell that is neither the
// selection nor a neighbor of it moves the selection to that cell.
//
// The FOURTH row of specs/controls.md's press table — "Any other cell — Moves
// the selection to that cell, with no offer standing" — and the row is only
// reachable because of the
// sentence above the table: "The rows below are evaluated in order, and the first
// row that matches is the one that applies." So the row says two things at once,
// and both are read here. A selection is standing, so row one ("while nothing is
// selected") cannot match; the press lands away from that selection, so rows two
// and three cannot match either; and what is left is this row, which moves the
// selection rather than clearing it, trading it away, or leaving it where it was.
//
// WHAT THE READING IS. The selection is at the pressed cell afterward, nothing
// is offered, and the board is exactly the board that was posed. Those last two
// are half of the point rather than a bonus: the row this press matches moves a
// selection and does NOTHING else, and a build that fell through to the third row
// instead would offer the gem into a cell no neighbor of it — or, worse, request
// the swap outright, which R1 refuses here and which would leave a refusal
// standing on two cells. So `offer` at null, `phase` at `idle` and no refusal are
// the same observation as the move: they say which row applied.
//
// THE TWO CELLS. The selection sits at (1,1) and the press lands at (5,5): four
// columns and four rows apart, so the pair is neither equal nor orthogonally
// adjacent by R1, and `areAdjacent` is asked rather than argued.
//
// THE PRESS IS POSED THROUGH THE SURFACE. specs/instrumentation.md makes
// `pointerDown` feed "the same input path a real pointer feeds" and resolve at
// the call, so a point about the press RULES reads the rule and nothing of a
// build's event plumbing or frame scheduling.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  assertBoardEquals,
  hasAnyRun,
  quietRowsWithEscape,
  type CellRef,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  releasePointer,
  type Harness,
} from "../harness";

/** The cell the selection stands on when the press is made. */
const SELECTED: CellRef = { col: 1, row: 1 };

/** The cell the press lands on: neither the selection nor a neighbor of it. */
const ELSEWHERE: CellRef = { col: 5, row: 5 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the selection to the pressed cell", async () => {
  // The quiet filler, which carries no run of its own, so nothing on this board
  // resolves unless the press asks it to and the reading below is of the press
  // alone. The escape keeps a legal swap on the board, so the round is not over.
  const posed = quietRowsWithEscape([]);
  assertTrue(!hasAnyRun(posed), "the posed board carries no run of its own");
  assertTrue(
    !areAdjacent(SELECTED, ELSEWHERE),
    "the pressed cell is not orthogonally adjacent to the selection, so the " +
      "press table's third row cannot match",
  );

  await loadBoard(h, posed);
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  const held = await h.snapshot();
  assertDeepEqual(
    held.selection,
    SELECTED,
    "the selection the press is made against",
  );
  assertNull(held.offer, "the offer standing before the press");

  const moved = await pressCell(h, ELSEWHERE);
  const board = await h.board();
  await releasePointer(h);

  // The frame that draws the moved selection, and the picture of it.
  await h.advance(1);
  await captureStill(h, "select");

  assertDeepEqual(moved.selection, ELSEWHERE, "the selection the press moved");
  assertNull(
    moved.offer,
    "the offer, which the row this press matches does not raise",
  );
  assertBoardEquals(
    board,
    posed,
    "the board a press that only moves the selection leaves untouched",
  );
  assertEqual(
    moved.phase,
    "idle",
    "the phase, since this row requests no swap and nothing resolves",
  );
  assertNull(
    moved.refusal,
    "the refusal a swap request against a non-adjacent cell would have left",
  );
});
