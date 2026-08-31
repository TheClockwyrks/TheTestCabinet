// Facet — pointer/press-miss: a press farther than GEM_HIT_R from every cell
// center lets go of the gem, and leaves the board as it stands.
//
// specs/controls.md states it as the last row of the press table: "No cell, the
// press lying farther than `GEM_HIT_R` from every cell center — Clears the
// selection and any offer, leaving the board as it stands."
// specs/instrumentation.md repeats it of the posed press: "A press on `playing`
// farther than `GEM_HIT_R` from every cell center and outside every target leaves
// the board as it stands and clears the selection." So the reading is a trio:
// nothing is selected, nothing is offered, and the board is exactly what it was.
//
// READ AS THE ROW IS WRITTEN, NOT AS "CHANGES NOTHING". The pointer itself moves
// — specs/instrumentation.md has the snapshot's `pointer` mirror every press on
// every screen, which is `pointer/pointer-mirrored`'s subject — so what stands
// still here is the board and the hold, and the row says the hold is let go of
// rather than left alone.
//
// THE PRESS MUST MISS THE PAUSE CONTROL TOO. specs/controls.md plays the board
// "on the `playing` screen, everywhere outside that screen's `pause` target", and
// where that rectangle sits is the build's design. A press inside it would be
// operating a control rather than the board, and the answer would be the pause
// menu rather than a miss. So the target is READ off the snapshot and the points
// this check presses at are chosen clear of it, rather than written down and
// hoped for.
//
// THREE SHAPES OF MISS, EACH RULING OUT A DIFFERENT WRONG RULE.
//
//  - Off the board area entirely, out at a corner of the stage. A build that
//    clamped the pointer onto the nearest cell rather than measuring a radius
//    selects a corner cell here.
//  - Just beyond a corner cell, four units past `GEM_HIT_R` (36) and nothing
//    more. A build whose radius is the cell pitch rather than half of it takes
//    this one.
//  - The interior point where four cells meet, 36 units diagonally from each of
//    the four centers, so 50.9 from every one of them. `GEM_HIT_R` is a RADIUS:
//    this point is inside the square of half-pitch around each center and outside
//    the circle, so a build that tested a box instead of a distance targets a
//    cell here and no other point in this file catches it.
//
// Several candidates of the first two shapes are offered and the ones clear of
// the build's own pause control are the ones pressed, so a build that put its
// control in one corner of the stage is read at another rather than failed for a
// placement the specification allows.
//
// EACH POINT IS PRESSED THREE TIMES, because the row has three clauses and only a
// standing hold makes two of them say anything. With nothing selected a wrong
// target shows as a selection appearing; with a selection standing it shows as
// that selection surviving; with a selection and an offer both standing it shows
// as the offer surviving — and that last one is the state a release would play a
// move from, so a build that leaves it standing has a press off the board arm a
// swap the player has walked away from.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNull,
} from "../assert";
import { CELL_PITCH, GEM_HIT_R, STAGE_H, STAGE_W } from "../constants";
import {
  assertBoardEquals,
  cellX,
  cellY,
  distanceToNearestCell,
  quietRowsWithEscape,
  type BoardRows,
  type CellRef,
  type TargetRect,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressPoint,
  releasePointer,
  targetById,
  type Harness,
} from "../harness";

/** The cell the hold stands on for the second and third halves of each probe. */
const SELECTED: CellRef = { col: 3, row: 3 };

/** The neighbor the held gem is offered into for the third half. */
const OFFERED: CellRef = { col: 4, row: 3 };

/** How many of the candidate points must survive the pause control to press at. */
const POINTS_WANTED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Every point this check would press at, each proved to lie farther than
 * `GEM_HIT_R` from all 64 cell centers before it is used.
 *
 * Proved rather than argued: a point that drifted inside the radius would turn
 * this check into an assertion that a press LETS GO of a gem when in fact it had
 * a cell to take hold of, which passes on a broken build.
 */
function missCandidates(): { name: string; x: number; y: number }[] {
  const gap = GEM_HIT_R + 4;
  const points = [
    { name: "the stage's top-left corner", x: 40, y: 40 },
    { name: "the stage's top-right corner", x: STAGE_W - 40, y: 40 },
    { name: "the stage's bottom-left corner", x: 40, y: STAGE_H - 40 },
    {
      name: "the stage's bottom-right corner",
      x: STAGE_W - 40,
      y: STAGE_H - 40,
    },
    { name: "just left of the first column", x: cellX(0) - gap, y: cellY(0) },
    { name: "just right of the last column", x: cellX(7) + gap, y: cellY(7) },
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
 * Whether a stage point lies inside a target's rectangle, its edges counted in.
 *
 * The edges are counted in because a press exactly on a border is a press a
 * build is entitled to read as inside the control, and this check only wants
 * points no reading of the rectangle can claim.
 */
function insideTarget(
  point: { x: number; y: number },
  target: TargetRect,
): boolean {
  return (
    point.x >= target.x &&
    point.x <= target.x + target.w &&
    point.y >= target.y &&
    point.y <= target.y + target.h
  );
}

it("lets go of the gem, and leaves the board as it stands", async () => {
  const posed = quietRowsWithEscape([]);
  const opened = loadBoard(h, posed);
  assertNull(opened.selection, "a posed board carries no selection");
  assertNull(opened.offer, "a posed board carries no offer");

  // The control the board is played around, read where the build put it.
  const pause = targetById(opened, "pause");
  const candidates = missCandidates();
  const points = candidates.filter((point) => !insideTarget(point, pause));
  assertGreaterThanOrEqual(
    points.length,
    POINTS_WANTED,
    `points clear of the pause target at (${pause.x},${pause.y}) ` +
      `${pause.w}x${pause.h}, out of the ${candidates.length} offered`,
  );

  /**
   * Press at a point that targets no cell, and assert the three things the row
   * states: nothing selected, nothing offered, the board standing.
   *
   * The release ends the hold, so the next probe is a fresh press rather than
   * the continuation of a drag.
   */
  const pressMisses = (
    point: { name: string; x: number; y: number },
    board: BoardRows,
    half: string,
  ): void => {
    const after = pressPoint(h, point.x, point.y);
    releasePointer(h);
    assertNull(
      after.selection,
      `the selection after a press at ${point.name}, ${half}`,
    );
    assertNull(
      after.offer,
      `the offer after a press at ${point.name}, ${half}`,
    );
    assertBoardEquals(
      h.board(),
      board,
      `the board after a press at ${point.name}, ${half}`,
    );
  };

  // Half one: with nothing held, nothing becomes held.
  for (const point of points) {
    pressMisses(point, posed, "with nothing held");
  }

  // Half two: a gem is held, and the press lets go of it.
  for (const point of points) {
    h.debug.setSelection(SELECTED.col, SELECTED.row);
    pressMisses(point, posed, "with a gem held");
  }

  // Half three: the gem is held AND offered into a neighbor, which is the state
  // a release plays a move from. Both must be gone.
  for (const point of points) {
    h.debug.setSelection(SELECTED.col, SELECTED.row);
    h.debug.setOffer(OFFERED.col, OFFERED.row);
    pressMisses(point, posed, "with a gem held and offered");
  }

  await h.advance(1);
  captureStill(h, "miss");
});
