// Facet — pointer/press-selects: a press within GEM_HIT_R of a cell's center,
// with nothing selected, takes hold of that cell.
//
// specs/controls.md fixes two things this point reads together, and they are one
// behavior rather than two. The first is WHICH cell a press targets: "the cell
// whose center is nearest the pointer position, when that center lies within
// `GEM_HIT_R` (`36`) of it". The second is what the press then does, from the
// first row of the press table: "Any cell, while nothing is selected — Selects
// that cell, with no offer standing." A press with nothing selected has no other
// row it can match, so the whole of what the press does is the targeting.
//
// THE OFFER IS HALF THE ROW. A move is offered and then played on a release, so a
// build that treated the first press as the beginning of a swap — offering the
// gem into whichever neighbor it guessed at — would have a release play a move a
// player never asked for. The row says "with no offer standing", and that is read
// after every press here.
//
// WHY THREE PRESSES RATHER THAN ONE. A build that answered only the exact center
// would pass a single press at a center and fail a player, and a build that hard
// wired one cell would pass it too. So the same press is made three ways: at a
// center, at a point well off that center but still inside the radius, and at a
// different cell entirely. Each is preceded by `clearSelection`, because the
// press table's later rows read against a standing selection and this row is the
// one that reads against none.
//
// THE PRESS IS POSED THROUGH THE SURFACE rather than driven with a real pointer.
// specs/instrumentation.md makes `pointerDown` drive "the same input path a real
// pointer drives" and resolve "in the state the call returns", so a point about
// the press RULES gets the rule and nothing of the engine's frame scheduling.
// The surface is written in the shape of `update` here — a pose is handed the
// state and returns the next one — and the harness applies each one through the
// engine, so what the check reads back is the state the press itself left.
//
// WHAT THIS DOES NOT ASSERT. Where a press farther than `GEM_HIT_R` from every
// center lands is `pointer/press-miss`, what a press on the cell already held
// does is `pointer/press-holds-again`, and the two rows about a standing
// selection are `pointer/press-offers` and `pointer/press-moves-selection`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertNull,
} from "../assert";
import { GEM_HIT_R, GEM_R } from "../constants";
import {
  assertBoardEquals,
  cellCenter,
  distanceToNearestCell,
  insideCell,
  quietRowsWithEscape,
  type CellRef,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressPoint,
  releasePointer,
  type Harness,
} from "../harness";

/**
 * How far off a center the second press lands: midway between `GEM_R` (30) and
 * `GEM_HIT_R` (36), so it is inside the radius a press is measured against and
 * outside the radius a gem is drawn within.
 */
const BETWEEN_RADII = (GEM_R + GEM_HIT_R) / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * A stage point lies inside `GEM_HIT_R` of `cell`'s center and nearer that
 * center than any other, so specs/controls.md's targeting rule names `cell` and
 * no other cell.
 *
 * Asserted of the FIXTURE before the press, so a point the check chose badly
 * fails as the check's own mistake rather than traveling into the build and
 * coming back as a verdict about it.
 */
function targetsOnly(point: { x: number; y: number }, cell: CellRef): void {
  const center = cellCenter(cell.col, cell.row);
  const reach = Math.hypot(point.x - center.x, point.y - center.y);
  const where = `(${cell.col},${cell.row}) from (${point.x},${point.y})`;
  assertLessThan(reach, GEM_HIT_R, `within GEM_HIT_R of ${where}`);
  assertCloseTo(
    distanceToNearestCell(point.x, point.y),
    reach,
    9,
    `no cell center nearer than ${where}`,
  );
}

/**
 * Press at `point` with nothing selected, and assert the row's two halves: the
 * cell it took hold of, and the offer it did not raise.
 *
 * The release ends the hold before the next press begins: specs/controls.md
 * turns a held pointer that reaches a neighbor into a drag, and this point is
 * about presses alone.
 */
function pressWithNothingSelected(
  point: { x: number; y: number },
  cell: CellRef,
  what: string,
): void {
  h.debug.clearSelection();
  h.debug.clearOffer();
  const before = h.snapshot();
  assertNull(before.selection, "nothing selected before the press");
  assertNull(before.offer, "nothing offered before the press");

  const pressed = pressPoint(h, point.x, point.y);
  releasePointer(h);

  assertDeepEqual(pressed.selection, cell, what);
  assertNull(pressed.offer, `the offer after ${what}`);
}

it("takes hold of the cell the press targets, offering nothing", async () => {
  // The filler carries no run, so nothing resolves under the presses, and its
  // spare corner swap keeps the round from ending while the scenario runs.
  const posed = quietRowsWithEscape([]);
  const opened = loadBoard(h, posed);
  assertNull(opened.selection, "a posed board carries no selection");
  assertNull(opened.offer, "a posed board carries no offer");

  // 1. The exact center — the position the radius is measured from.
  const middle: CellRef = { col: 3, row: 3 };
  const center = cellCenter(middle.col, middle.row);
  targetsOnly(center, middle);
  pressWithNothingSelected(
    center,
    middle,
    "a press at a cell's center selects that cell",
  );

  // 2. Off that center by the midpoint of the two radii specs/board.md names:
  //    inside `GEM_HIT_R` (36), which is what a press is measured against, and
  //    outside `GEM_R` (30), which is only how far a gem is DRAWN. A build that
  //    measured the press against the artwork rather than the hit radius fails
  //    here, and a build that answered its centers alone fails here too. The
  //    point is 39 from (4,3)'s center, so no second cell is in reach.
  const offCenter = insideCell(middle.col, middle.row, BETWEEN_RADII, 0);
  targetsOnly(offCenter, middle);
  pressWithNothingSelected(
    offCenter,
    middle,
    `a press ${BETWEEN_RADII} units off the center is inside GEM_HIT_R of it`,
  );

  // 3. A different cell entirely, at the far corner of the board: the selection
  //    follows the press rather than resting anywhere fixed.
  const corner: CellRef = { col: 7, row: 7 };
  const cornerCenter = cellCenter(corner.col, corner.row);
  targetsOnly(cornerCenter, corner);
  pressWithNothingSelected(
    cornerCenter,
    corner,
    "a press selects the cell it landed on, not a fixed one",
  );

  // The frame is what the still is of, and it also proves the presses left the
  // board resting: taking hold of a gem is not a move, so nothing resolved.
  await h.advance(1);
  captureStill(h, "select");
  const after = h.snapshot();
  assertEqual(after.phase, "idle", "a selecting press requests no swap");
  assertBoardEquals(h.board(), posed, "the board a selection was made on");
});
