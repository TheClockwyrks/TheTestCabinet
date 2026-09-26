// Refract — tracing/shared-node-refused: a press on a node two beams share
// begins no trace.
//
// specs/controls.md "Beginning a trace": a press that matches no grab row
// begins no trace and leaves the board unchanged — and that explicitly covers
// a press on a node that MORE THAN ONE beam passes through. The shortening
// row matches a node exactly ONE beam passes through, so a shared mid node
// matches nothing.
//
// The pose has to keep the shared node off every beam's END, or the resume
// row would match first (that ordering is grab-end-wins-over-mid's item), and
// it has to leave the board unsolved so the press still lands on `playing`.
// So: a two-charge crystal both channels cross completely — mid cell of both
// beams — with an unvisited triangle lens holding the triangle beam short of
// complete (R7, specs/beams.md), which keeps R9 false.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

/**
 * specs/board.md notation: triangle across the top through the two-charge
 * crystal, square across underneath it by two diagonals of distinct blocks,
 * and a triangle lens at (2, 2) no beam visits.
 */
const SHARED_MID = `
T2T
S.S
..t
`;

const CRYSTAL = { col: 1, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press on a node more than one beam passes through begins no trace and leaves the board unchanged", async () => {
  await resetTo(h);
  await loadBoard(h, SHARED_MID);

  // Both channels cross the crystal completely, so it is a mid cell of both
  // beams; the unvisited lens keeps the board unsolved.
  traceCells(h, [{ col: 0, row: 0 }, CRYSTAL, { col: 2, row: 0 }]);
  traceCells(h, [{ col: 0, row: 1 }, CRYSTAL, { col: 2, row: 1 }]);

  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [{ col: 0, row: 0 }, CRYSTAL, { col: 2, row: 0 }],
    "the triangle beam passes through the shared node",
  );
  assertDeepEqual(
    before.beams.square?.cells,
    [{ col: 0, row: 1 }, CRYSTAL, { col: 2, row: 1 }],
    "the square beam passes through the shared node",
  );
  assertEqual(
    before.screen,
    "playing",
    "the unvisited lens keeps the board unsolved",
  );

  pressCell(h, CRYSTAL);

  const after = h.snapshot();
  assertNull(
    after.tracing,
    "a press on a node two beams share begins no trace",
  );
  assertDeepEqual(after.beams, before.beams, "every beam is left as it was");
  assertDeepEqual(
    after.board,
    before.board,
    "the board — nodes, charges, spent counts — is unchanged",
  );
  h.debug.pointerUp();

  // Evidence: the board unchanged by the shared-node press.
  await h.advance(1);
  captureStill(h, "unchanged");
});
