// Refract — pointer/touch-draws-a-beam: a touch draws exactly the beam a mouse
// draws.
//
// specs/controls.md: the pointer is a mouse, a pen, or a finger, and the game
// acts on the position, the press, and the release alone. The same route is
// drawn twice on the same posed board, once from each device, and the two beams
// are compared cell for cell — so a build that reads the device anywhere it
// should not fails here rather than at a reviewer's fingertip.
//
// WHEN THE DEVICE IS READ. At the pose, before the frame that draws the beam.
// specs/state.md makes `state.pointer` the pointer as the game read it from its
// input, refreshed every update, and specs/instrumentation.md makes a posed
// touch reach the game's input path at the call — never the engine's own
// pointer — so a build that refreshes the mirror from the engine's pointer
// every update reports the engine's resting mouse one frame after the pose.
// The specification admits that design as it admits a mirror the game's own
// resolution writes; the two agree at the pose, where a posed touch and a posed
// mouse "differ only in the device the state reports". The beam is read after
// the frame like every posed route.

import { afterEach, beforeEach, it } from "vitest";
import { R9_UNIQUE } from "../fixtures";
import { cellCenterOf } from "../pointer-helpers";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the same beam a mouse leaves, drawn from a touch", async () => {
  await resetTo(h);
  const board = await loadBoard(h, R9_UNIQUE);

  const start = cellCenterOf(board, { col: 0, row: 0 });
  const next = cellCenterOf(board, { col: 0, row: 1 });

  h.debug.pointerDown(start.x, start.y, "touch");
  h.debug.pointerMove(next.x, next.y, "touch");
  h.debug.pointerUp("touch");
  assertEqual(
    h.snapshot().pointer.device,
    "touch",
    "the state reports the device that drew it",
  );
  await h.advance(1);

  const drawn = h.snapshot().beams.triangle?.cells ?? [];
  assertDeepEqual(
    drawn,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
    ],
    "a touch press, move, and release draw the segment joining the two nodes " +
      "(specs/controls.md, Extending)",
  );
  captureStill(h, "drawn");

  // The identical gesture from a mouse, on a board posed fresh.
  await resetTo(h);
  await loadBoard(h, R9_UNIQUE);
  h.debug.pointerDown(start.x, start.y, "mouse");
  h.debug.pointerMove(next.x, next.y, "mouse");
  h.debug.pointerUp("mouse");
  await h.advance(1);

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells ?? [],
    drawn,
    "and a mouse leaves exactly the same beam",
  );
});
