// ruleset/r3-segment-exclusivity — R3: each segment carries at most one beam
// and is used at most once.
//
// The redraw has to be posed as an EXTEND, not as a retract: moving onto the
// node immediately behind the live end REMOVES the last segment
// (specs/controls.md, Retracting), so the live end must arrive beside an
// already-used segment by some other route. Crystals are what make that
// posable cleanly — channel-neutral, entered once per unspent charge
// (specs/beams.md R5) — so both boards here are private to this suite, built
// in the notation of specs/board.md:
//
//   SAME-BEAM. "T22T / .tt.": the triangle beam runs T(0,0) into crystal
//   X(1,0), across crystal Y(2,0), down and around the two lenses, and back
//   into X (its second charge). From X the move to Y would redraw the
//   already-held segment X–Y. Y has a charge to spare, the move is adjacent,
//   not a diagonal, and X's neighbour behind is t(1,1) — so R3 is the only
//   rule in play.
//
//   SECOND-CHANNEL. "T..T / .22. / S..S": the triangle beam is drawn complete
//   through both crystals, then the square trace enters X(1,1) on its second
//   charge and attempts X–Y — the very segment the triangle beam carries.
//   Fresh diagonal blocks, spare charge on Y: R3 alone refuses it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

/** One channel, two 2-charge crystals: the beam can come back beside its own segment. */
const SAME_BEAM = `
T22T
.tt.
`;

/** Two channels sharing two 2-charge crystals: both can reach the same segment. */
const SECOND_CHANNEL = `
T..T
.22.
S..S
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

it("refuses a second channel drawing the same segment", async () => {
  const board = await loadBoard(h, SECOND_CHANNEL);

  // The triangle beam takes the segment between the two crystals first.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 1 },
    { col: 3, row: 0 },
  ]);

  // The square trace enters crystal X(1, 1) on its remaining charge, then
  // attempts the crystal-to-crystal segment the triangle beam carries.
  await pressAt(h, board, { col: 0, row: 2 });
  await moveOver(h, board, { col: 1, row: 1 });
  const before = await h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the square beam reaches the first crystal before the refused move",
  );

  await moveOver(h, board, { col: 2, row: 1 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the segment carries at most one beam: the square move is refused",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the square trace stays live through the refused move",
  );
});
