// Refract — pointer/pointer-clears-the-board: taking the clear target empties
// every beam.
//
// specs/controls.md: taking `clear` does what the `clear` action does, which is
// to empty every beam on the board and leave the nodes untouched. The board is
// posed and drawn on through the same pointer path a player uses, so what is
// cleared is a beam the build itself decided to draw.

import { afterEach, beforeEach, it } from "vitest";
import { R9_UNIQUE } from "../fixtures";
import { cellCenterOf } from "../pointer-helpers";
import { assertGreaterThanOrEqual, assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressRelease,
  resetTo,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the beams when the clear control is taken", async () => {
  await resetTo(h, 1);
  const board = await loadBoard(h, R9_UNIQUE);

  const start = cellCenterOf(board, { col: 0, row: 0 });
  const next = cellCenterOf(board, { col: 0, row: 1 });
  h.debug.pointerDown(start.x, start.y);
  h.debug.pointerMove(next.x, next.y);
  h.debug.pointerUp();
  await h.advance(1);

  assertGreaterThanOrEqual(
    (h.snapshot().beams.triangle?.cells ?? []).length,
    2,
    "a segment is drawn before the board is cleared",
  );

  const clear = targetCenter(targetById(h.snapshot(), "clear"));
  await pressRelease(h, clear);

  const cleared = h.snapshot();
  for (const [channel, beam] of Object.entries(cleared.beams)) {
    assertDeepEqual(
      beam?.cells ?? [],
      [],
      `taking the clear target empties the ${channel} beam ` +
        "(specs/controls.md, Clearing)",
    );
  }
  assertGreaterThanOrEqual(
    cleared.board.nodes.length,
    1,
    "and leaves the board's nodes untouched",
  );
  captureStill(h, "cleared");
});
