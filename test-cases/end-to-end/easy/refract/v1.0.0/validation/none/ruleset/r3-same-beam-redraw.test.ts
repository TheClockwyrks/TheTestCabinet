// ruleset/r3-same-beam-redraw — R3: a segment is used at most once, so a beam
// may not redraw a segment it already holds.
//
// The redraw has to be posed as an EXTEND, not as a retract: moving onto the
// node immediately behind the live end REMOVES the last segment
// (specs/controls.md, Retracting), so the live end must arrive beside an
// already-used segment by some other route. Crystals are what make that
// posable cleanly — channel-neutral, entered once per unspent charge
// (specs/beams.md R5) — so the board here is private to this suite, built in
// the notation of specs/board.md:
//
//   "T22T / .tt.": the triangle beam runs T(0,0) into crystal X(1,0), across
//   crystal Y(2,0), down and around the two lenses, and back into X (its
//   second charge). From X the move to Y would redraw the already-held segment
//   X–Y. Y has a charge to spare, the move is adjacent, not a diagonal, and
//   X's neighbour behind is t(1,1) — so R3 is the only rule in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

/** One channel, two 2-charge crystals: the beam can come back beside its own segment. */
const SAME_BEAM = `
T22T
.tt.
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses redrawing a segment the same beam already holds", async () => {
  const board = await loadBoard(h, SAME_BEAM);

  // Loop the beam around so its live end sits at crystal X(1, 0) again, with
  // the segment X–Y(2, 0) already held from the first pass.
  await pressAt(h, board, { col: 0, row: 0 });
  await moveOver(h, board, { col: 1, row: 0 });
  await moveOver(h, board, { col: 2, row: 0 });
  await moveOver(h, board, { col: 2, row: 1 });
  await moveOver(h, board, { col: 1, row: 1 });
  await moveOver(h, board, { col: 1, row: 0 });
  const before = await h.snapshot();
  assertDeepEqual(
    before.tracing,
    { channel: "triangle", live: { col: 1, row: 0 } },
    "the loop brings the live end back to the crystal at (1, 0)",
  );

  // The segment X–Y is already part of this beam: used at most once.
  await moveOver(h, board, { col: 2, row: 0 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the beam is unchanged by redrawing its own segment",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the trace stays live through the refused redraw",
  );
});
