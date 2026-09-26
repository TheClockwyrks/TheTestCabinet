// Refract — ruleset/r3-second-channel: R3 Segment exclusivity, second channel.
//
// specs/beams.md R3: "Each segment carries at most one beam and is used at
// most once." The board below is private to this suite, built so R3 is the one
// rule the attempted move breaks: the crystals are channel-neutral
// (specs/beams.md R8) and each keeps a spare charge at the attempt, and the
// crossing diagonal ledger is untouched. Per the enforcement table a refused
// move leaves the beam unchanged and the trace live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  toCells,
  traceCells,
  type Harness,
} from "../harness";

/**
 * Private fixture — two channels, one segment. The two 2-charge crystals sit
 * between the channels; triangle draws the crystal-to-crystal segment first,
 * and the square beam reaching the first crystal then attempts that same
 * segment. Each crystal keeps a spare charge at the attempt.
 */
const R3_TWO_CHANNELS = `
T..T
.22.
S..S
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a second channel drawing the same segment is refused", async () => {
  await resetTo(h);
  await loadBoard(h, R3_TWO_CHANNELS);

  // Triangle draws the crystal-to-crystal segment on its way across.
  traceCells(
    h,
    toCells([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]),
  );

  // Square reaches the first crystal, then attempts the segment triangle drew.
  pressCell(h, { col: 0, row: 2 });
  moveToCell(h, { col: 1, row: 1 });
  const drawn = [
    { col: 0, row: 2 },
    { col: 1, row: 1 },
  ];
  assertDeepEqual(
    h.snapshot().beams.square?.cells,
    drawn,
    "the square beam reaches the first crystal",
  );

  moveToCell(h, { col: 2, row: 1 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.square?.cells,
    drawn,
    "the segment already carrying the triangle beam is refused a second beam",
  );
  assertDeepEqual(
    after.beams.triangle?.cells,
    toCells([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]),
    "the triangle beam that holds the segment is untouched",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the segment refused a second use.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
