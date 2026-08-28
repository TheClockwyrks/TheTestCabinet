// Refract — tracing/grab-end-wins-over-mid: a beam's end wins over another
// beam's middle.
//
// specs/controls.md "Beginning a trace": the grab rows are EVALUATED IN
// ORDER, and the first row that matches is the one that applies. The second
// row — either end of a channel's beam — therefore beats everything after it,
// so a press on a node that is one beam's end and a mid cell of another
// resumes the beam whose end it is.
//
// The node is SHARED_CRYSTAL's two-charge crystal (1, 0): the square beam
// crosses it completely (a mid cell), and the triangle beam is drawn one
// segment onto it and released (its end). The board stays unsolved — the
// triangle beam is incomplete — so the press lands on `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { SHARED_CRYSTAL } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

const CRYSTAL = { col: 1, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press on a node that is one beam's end and another's mid cell resumes the beam whose end it is", async () => {
  await resetTo(h, 1);
  await loadBoard(h, SHARED_CRYSTAL);

  // The square beam THROUGH the crystal — S(0,1) in by one diagonal, out to
  // S(2,1) by the other, distinct 2x2 blocks — then the triangle beam ONTO
  // it, ending there.
  h.debug.trace([{ col: 0, row: 1 }, CRYSTAL, { col: 2, row: 1 }]);
  h.debug.trace([{ col: 0, row: 0 }, CRYSTAL]);

  const before = h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [{ col: 0, row: 1 }, CRYSTAL, { col: 2, row: 1 }],
    "the crystal is a mid cell of the square beam",
  );
  assertDeepEqual(
    before.beams.triangle?.cells,
    [{ col: 0, row: 0 }, CRYSTAL],
    "the crystal is the triangle beam's end",
  );
  assertEqual(before.screen, "playing", "the board is not yet solved");

  pressCell(h, CRYSTAL);

  const after = h.snapshot();
  assertEqual(
    after.tracing?.channel,
    "triangle",
    "the resumed beam is the one whose end the pressed node is",
  );
  assertDeepEqual(
    after.tracing?.live,
    CRYSTAL,
    "the trace resumes from that end",
  );
  assertDeepEqual(
    after.beams,
    before.beams,
    "resuming an end shortens nothing on either beam",
  );
  h.debug.pointerUp();

  // Evidence: the end grabbed ahead of the mid cell.
  await h.advance(1);
  captureStill(h, "grabbed");
});
