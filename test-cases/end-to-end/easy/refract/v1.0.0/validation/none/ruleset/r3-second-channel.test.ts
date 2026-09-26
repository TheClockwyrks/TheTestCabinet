// ruleset/r3-second-channel — R3: each segment carries at most one beam, so a
// second channel may not draw a segment another channel's beam holds.
//
// The board is private to this suite, built in the notation of specs/board.md:
//
//   "T..T / .22. / S..S": the triangle beam is drawn complete through both
//   crystals, then the square trace enters X(1,1) on its second charge and
//   attempts X–Y — the very segment the triangle beam carries. Fresh diagonal
//   blocks, spare charge on Y: R3 alone refuses it. Crystals are
//   channel-neutral (specs/beams.md R8), so R2 has nothing to say about the
//   square entering them.

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
