// ruleset/r5-lens-capacity — R5: a lens carries at most two segments of its
// own channel.
//
// THE POSE. `R5_LENS`:
//
//   T..
//   tt.
//   .tT
//
// The route T(0,0)–t(1,1)–t(0,1)–t(1,2) leaves the lens at (1,1) carrying its
// two segments. From the live end t(1,2), the move back onto t(1,1) would be
// a THIRD segment of the lens's own channel onto it — refused, and for no
// other reason: the segment is fresh and vertical, the target is the
// channel's own lens, and the live end's lens carries only one segment
// (specs/beams.md R5; the enforcement table: the beam is unchanged and the
// trace stays live).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R5_LENS } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a third segment of its own channel onto a lens carrying two", async () => {
  const board = await loadBoard(h, R5_LENS);

  // Fill the lens at (1, 1): the beam enters it from the emitter and leaves
  // it for the neighbouring lens — its two segments.
  await pressAt(h, board, { col: 0, row: 0 });
  await moveOver(h, board, { col: 1, row: 1 });
  await moveOver(h, board, { col: 0, row: 1 });
  await moveOver(h, board, { col: 1, row: 2 });
  const before = await h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
      { col: 1, row: 2 },
    ],
    "the route fills the lens at (1, 1) with its two segments",
  );

  // The third segment onto the full lens.
  await moveOver(h, board, { col: 1, row: 1 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the beam is unchanged by the third segment onto the lens",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the trace stays live through the refused move",
  );
});
