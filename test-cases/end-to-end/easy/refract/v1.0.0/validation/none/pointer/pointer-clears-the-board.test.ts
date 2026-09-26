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
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the beams when the clear control is taken", async () => {
  await h.debug.reset();
  await h.advance(1);
  const board = await loadBoard(h, R9_UNIQUE);

  const start = cellCenterOf(board, { col: 0, row: 0 });
  const next = cellCenterOf(board, { col: 0, row: 1 });
  await h.debug.pointerDown(start.x, start.y);
  await h.debug.pointerMove(next.x, next.y);
  await h.debug.pointerUp();
  await h.advance(1);

  assertGreaterThanOrEqual(
    ((await h.snapshot()).beams.triangle?.cells ?? []).length,
    2,
    "a segment is drawn before the board is cleared",
  );

  const clear = targetCenter(targetById(await h.snapshot(), "clear"));
  await pressRelease(h, clear);

  const cleared = await h.snapshot();
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
  await captureStill(h, "cleared");
});
