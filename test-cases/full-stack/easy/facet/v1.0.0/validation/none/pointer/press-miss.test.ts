// Facet — pointer/press-miss: a press farther than GEM_HIT_R from every cell
// center targets no cell, and changes nothing.
//
// specs/controls.md states it as a sentence of its own — "A press farther than
// `GEM_HIT_R` from every cell center targets no cell and changes nothing" — and
// specs/instrumentation.md repeats it of the posed press: "A press farther than
// `GEM_HIT_R` from every cell center leaves the board and the selection as they
// stand." So the reading is a pair: the selection is exactly what it was, and the
// board is exactly what it was.
//
// THREE POINTS, EACH RULING OUT A DIFFERENT WRONG RULE.
//
//  - Off the stage's board area entirely, near the top-left corner of the stage.
//    A build that clamped the pointer onto the nearest cell rather than measuring
//    a radius selects (0,0) here.
//  - Just beyond a corner cell, 40 units out along one axis: past `GEM_HIT_R`
//    (36) by four units and nothing more. A build whose radius is the cell pitch
//    rather than half of it takes this one.
//  - The interior point where four cells meet, 36 units diagonally from each of
//    the four centers, so 50.9 from every one of them. `GEM_HIT_R` is a RADIUS:
//    this point is inside the square of half-pitch around each center and outside
//    the circle, so a build that tested a box instead of a distance targets a
//    cell here and no other point in this file catches it.
//
// EACH POINT IS PRESSED TWICE, because the sentence has two halves and a
// standing selection is what makes the second half say something. With nothing
// selected a wrong target shows as a selection appearing; with a selection
// standing it shows as that selection moving, clearing, or being traded away.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertNull,
} from "../assert";
import { CELL_PITCH, GEM_HIT_R } from "../constants";
import {
  assertBoardEquals,
  cellX,
  cellY,
  distanceToNearestCell,
  offBoardPoint,
  quietRowsWithEscape,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/** The cell a selection stands on for the second half of each probe. */
const SELECTED: CellRef = { col: 3, row: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The three points this check presses at, each proved to lie farther than
 * `GEM_HIT_R` from every one of the 64 cell centers before it is used.
 *
 * Proved rather than argued: a point that drifted inside the radius would turn
 * this check into an assertion that a press SELECTS nothing when in fact it had
 * a cell to select, which passes on a broken build.
 */
function missPoints(): { name: string; x: number; y: number }[] {
  const points = [
    { name: "off the board entirely", ...offBoardPoint() },
    {
      name: "beyond the corner cell",
      x: cellX(0) - GEM_HIT_R - 4,
      y: cellY(0),
    },
    {
      name: "the gap where four cells meet",
      x: cellX(3) + CELL_PITCH / 2,
      y: cellY(3) + CELL_PITCH / 2,
    },
  ];
  for (const point of points) {
    assertGreaterThan(
      distanceToNearestCell(point.x, point.y),
      GEM_HIT_R,
      `${point.name} lies farther than GEM_HIT_R from every cell center`,
    );
  }
  return points;
}

/**
 * Press at a point that targets no cell, and assert the two things the
 * specification says stand: the selection and the board.
 *
 * The release ends the hold, so the next probe is a fresh press rather than the
 * continuation of a drag.
 */
async function pressMisses(
  point: { name: string; x: number; y: number },
  selection: CellRef | null,
  posed: BoardRows,
): Promise<void> {
  await h.debug.pointerDown(point.x, point.y);
  const after = await h.snapshot();
  await h.debug.pointerUp();
  assertDeepEqual(
    after.selection,
    selection,
    `the selection stands after a press ${point.name}`,
  );
  assertBoardEquals(
    await h.board(),
    posed,
    `the board stands after a press ${point.name}`,
  );
}

it("targets no cell, and changes nothing", async () => {
  const posed = quietRowsWithEscape([]);
  const opened = await loadBoard(h, posed);
  assertNull(opened.selection, "a posed board carries no selection");

  // Half one: with nothing selected, nothing becomes selected.
  for (const point of missPoints()) {
    await pressMisses(point, null, posed);
  }

  // Half two: with a selection standing, it is neither moved, nor cleared, nor
  // traded away — the last of which is what a build that targeted one of the
  // four cells around the interior gap would do, since two of them are
  // orthogonally adjacent to the selected cell.
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  assertDeepEqual(
    (await h.snapshot()).selection,
    SELECTED,
    "the selection this half stands on",
  );
  for (const point of missPoints()) {
    await pressMisses(point, SELECTED, posed);
  }

  await h.advance(1);
  await captureStill(h, "miss");
});
