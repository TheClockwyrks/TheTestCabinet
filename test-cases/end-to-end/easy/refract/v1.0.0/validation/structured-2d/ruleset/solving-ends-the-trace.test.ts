// Refract — ruleset/solving-ends-the-trace: solving ends the live trace on
// the spot.
//
// specs/controls.md, Releasing: "A trace also ends the moment the board is
// solved. On the frame a segment satisfies the solved condition the trace
// ends and the beams stay exactly as drawn, and the release edge that follows
// begins nothing and changes nothing." On R9_UNIQUE the forced solution is
// drawn by hand; on the solving move `tracing` is already null, the release
// that follows leaves the beams exactly as drawn, and a further press changes
// nothing — so a solved board cannot be taken apart by retracting.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  toCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the solving move ends the trace, and the beams hold thereafter", async () => {
  await resetTo(h);
  await loadBoard(h, R9_UNIQUE);

  const solution: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 2],
  ];
  pressCell(h, { col: 0, row: 0 });
  for (const [col, row] of solution.slice(1)) moveToCell(h, { col, row });

  // The solving move: the trace is null on the spot, the beams as drawn.
  const solvedCells = toCells(solution);
  const onSolve = h.snapshot();
  assertEqual(onSolve.solved, true, "the final move solves the board");
  assertNull(onSolve.tracing, "the trace is null on the solving move");
  assertDeepEqual(
    onSolve.beams.triangle?.cells,
    solvedCells,
    "the beams stay exactly as drawn on the solve",
  );

  // The release that follows begins nothing and changes nothing.
  h.debug.pointerUp();
  const afterRelease = h.snapshot();
  assertDeepEqual(
    afterRelease.beams.triangle?.cells,
    solvedCells,
    "the release that follows leaves the beams exactly as drawn",
  );
  assertNull(afterRelease.tracing, "the release begins nothing");
  assertEqual(afterRelease.solved, true, "the board stays solved");

  // A further press changes nothing: the beam cannot be resumed, shortened,
  // or retracted once the board is solved.
  pressCell(h, { col: 3, row: 2 });
  const afterPress = h.snapshot();
  assertDeepEqual(
    afterPress.beams.triangle?.cells,
    solvedCells,
    "a further press leaves the beams exactly as drawn",
  );
  assertNull(afterPress.tracing, "a further press begins no trace");
  assertEqual(
    afterPress.solved,
    true,
    "the solved board cannot be taken apart",
  );
  assertEqual(
    afterPress.screen,
    afterRelease.screen,
    "the press moves no screen",
  );
  h.debug.pointerUp();

  // Evidence: the solved board holding its beams.
  await h.advance(1);
  captureStill(h, "held");
});
