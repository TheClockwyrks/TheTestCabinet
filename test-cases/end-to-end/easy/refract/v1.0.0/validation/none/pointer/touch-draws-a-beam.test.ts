// Refract — pointer/touch-draws-a-beam: a touch draws exactly the beam a mouse
// draws.
//
// specs/controls.md: the pointer is a mouse, a pen, or a finger, and the game
// acts on the position, the press, and the release alone. The same route is
// drawn twice on the same posed board, once from each device, and the two beams
// are compared cell for cell — so a build that reads the device anywhere it
// should not fails here rather than at a reviewer's fingertip.

import { afterEach, beforeEach, it } from "vitest";
import { R9_UNIQUE } from "../fixtures";
import { cellCenterOf } from "../pointer-helpers";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the same beam a mouse leaves, drawn from a touch", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  const board = await loadBoard(h, R9_UNIQUE);

  const start = cellCenterOf(board, { col: 0, row: 0 });
  const next = cellCenterOf(board, { col: 0, row: 1 });

  await h.debug.pointerDown(start.x, start.y, "touch");
  await h.debug.pointerMove(next.x, next.y, "touch");
  await h.debug.pointerUp("touch");
  await h.advance(1);

  const touched = await h.snapshot();
  assertEqual(
    touched.pointer.device,
    "touch",
    "the state reports the device that drew it",
  );
  const drawn = touched.beams.triangle?.cells ?? [];
  assertDeepEqual(
    drawn,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
    ],
    "a touch press, move, and release draw the segment joining the two nodes " +
      "(specs/controls.md, Extending)",
  );
  await captureStill(h, "drawn");

  // The identical gesture from a mouse, on a board posed fresh.
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  await loadBoard(h, R9_UNIQUE);
  await h.debug.pointerDown(start.x, start.y, "mouse");
  await h.debug.pointerMove(next.x, next.y, "mouse");
  await h.debug.pointerUp("mouse");
  await h.advance(1);

  assertDeepEqual(
    (await h.snapshot()).beams.triangle?.cells ?? [],
    drawn,
    "and a mouse leaves exactly the same beam",
  );
});
