// ruleset/solving-ends-the-trace — solving ends the live trace on the spot,
// and a solved board cannot be taken apart.
//
// specs/controls.md (Releasing): "A trace also ends the moment the board is
// solved. On the frame a segment satisfies the solved condition the trace
// ends and the beams stay exactly as drawn, and the release edge that follows
// begins nothing and changes nothing." The board is the R9_UNIQUE fixture and
// the route its forced solution, driven move by move so the reading lands on
// the exact call that solves:
//
//   - on the solving move, `tracing` is already null — the pointer is still
//     down, and the trace is over anyway;
//   - the release that follows leaves the beams identical;
//   - a further press on the beam's end, a move back along it (the retract
//     gesture), and the release all change nothing — the solved board cannot
//     be taken apart by retracting.
//
// The solved screen draws its own menu over the finished board, and where its
// `menu-<i>` targets sit is the build's to choose (specs/controls.md, Pointer
// targets). The press and the retract move stay on the board cells the gesture
// is about — arming or highlighting a target changes no beam — and only the
// release is moved, to the first point the build's own target list leaves free,
// so no choice can be taken by the gesture whatever layout the build drew
// (specs/controls.md: a release anywhere but the armed target takes nothing).
//
// Beams are compared with the pointer fields left out: the snapshot's
// `pointer` mirrors the pointer the surface reports (specs/instrumentation.md)
// and moves with every pose, while the beams must not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  pointOutsideEveryTarget,
  resetTo,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R9_UNIQUE is `T... / ttt. / ...T`: 4 columns, 3 rows. */
const COLS = 4;
const ROWS = 3;

/** The forced solution, in drawn order. */
const SOLUTION: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);
});

afterEach(() => {
  h?.dispose();
});

it("ends the trace on the solving move and holds the beams against a further press", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  const [start, ...moves] = SOLUTION;
  h.debug.pointerDown(at(start[0], start[1]).x, at(start[0], start[1]).y);
  for (const [col, row] of moves.slice(0, -1)) {
    h.debug.pointerMove(at(col, row).x, at(col, row).y);
  }
  assertLiveTrace(
    h.snapshot(),
    "triangle",
    { col: 2, row: 1 },
    "the trace is live through the penultimate move",
  );

  // The solving move: the trace ends on the spot, pointer still down.
  const [lastCol, lastRow] = SOLUTION[SOLUTION.length - 1];
  h.debug.pointerMove(at(lastCol, lastRow).x, at(lastCol, lastRow).y);
  const solved = h.snapshot();
  assertEqual(solved.solved, true, "the final move solves the board");
  assertNull(
    solved.tracing,
    "the trace is null on the frame a move solves the board " +
      "(specs/controls.md: a trace also ends the moment the board is solved)",
  );
  const held = solved.beams;

  // The release that follows begins nothing and changes nothing.
  h.debug.pointerUp();
  const released = h.snapshot();
  assertDeepEqual(
    released.beams,
    held,
    "the beams stay exactly as drawn after the release that follows " +
      "(specs/controls.md)",
  );
  assertNull(released.tracing, "the release begins no trace");

  // A further press on the beam's end, and the retract gesture back along
  // it: nothing changes, so the solved board cannot be taken apart.
  h.debug.pointerDown(at(lastCol, lastRow).x, at(lastCol, lastRow).y);
  const pressed = h.snapshot();
  assertNull(
    pressed.tracing,
    "a further press begins no trace on the solved board",
  );
  assertDeepEqual(
    pressed.beams,
    held,
    "a further press changes nothing — the beams hold (specs/controls.md)",
  );

  h.debug.pointerMove(at(2, 1).x, at(2, 1).y);
  const retracted = h.snapshot();
  assertDeepEqual(
    retracted.beams,
    held,
    "the retract gesture takes nothing apart — the solved board holds its " +
      "beams (specs/controls.md)",
  );
  assertNull(retracted.tracing, "no trace survives the retract gesture");

  // The release lands where the build itself reports no target, so the gesture
  // ends without taking a choice off the solved screen's menu.
  const away = pointOutsideEveryTarget(h.snapshot().targets);
  h.debug.pointerMove(away.x, away.y);
  h.debug.pointerUp();
  const after = h.snapshot();
  assertDeepEqual(
    after.beams,
    held,
    "the release that ends the gesture takes nothing apart either " +
      "(specs/controls.md)",
  );
  assertNull(after.tracing, "no trace survives the further gesture");

  // Evidence: the solved board holding its beams.
  await h.advance(1);
  captureStill(h, "held");
});
