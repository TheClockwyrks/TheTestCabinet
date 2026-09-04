// Refract — tracing/shorten-keeps-last-occurrence: shortening keeps a
// repeated node's last occurrence.
//
// specs/controls.md "The drawn order and shortening": a beam that crosses a
// node more than once carries that node more than once, and the last of those
// occurrences in the held order is the one kept, so the beam loses as few
// segments as it can.
//
// The beam is CRYSTAL_TWICE's double crossing, stopped short of the far
// emitter so the board stays unsolved and the press still lands on `playing`:
// T(0,0) into the two-charge crystal (1,1), out to t(0,2), around by t(1,2)
// back into the crystal, out through t(1,0) to t(2,1). The crystal's cell
// appears at drawn-order indices 1 and 4; a press there keeps everything
// through index 4.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CRYSTAL_TWICE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

const CRYSTAL = { col: 1, row: 1 };

/** The double crossing, short of T(3,0) so nothing solves. */
const ROUTE = [
  { col: 0, row: 0 },
  CRYSTAL,
  { col: 0, row: 2 },
  { col: 1, row: 2 },
  CRYSTAL,
  { col: 1, row: 0 },
  { col: 2, row: 1 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press on a twice-carried cell drops only the cells after its last occurrence", async () => {
  await resetTo(h, 1);
  await loadBoard(h, CRYSTAL_TWICE);

  traceCells(h, ROUTE);

  // The precondition the item states: the beam carries the crystal's cell
  // twice.
  const drawn = h.snapshot().beams.triangle?.cells ?? [];
  assertDeepEqual(drawn, ROUTE, "the double crossing is drawn as listed");
  assertEqual(
    drawn.filter((c) => c.col === CRYSTAL.col && c.row === CRYSTAL.row).length,
    2,
    "the beam carries the crystal's cell twice",
  );

  pressCell(h, CRYSTAL);

  const snap = h.snapshot();
  assertDeepEqual(
    snap.beams.triangle?.cells,
    ROUTE.slice(0, 5),
    "the cells after the LAST occurrence are dropped, and no others",
  );
  assertDeepEqual(
    snap.tracing?.live,
    CRYSTAL,
    "the trace resumes from the pressed node",
  );

  // Evidence: the twice-crossed beam shortened at the crystal.
  await h.advance(1);
  captureStill(h, "shortened");
  h.debug.pointerUp();
});
