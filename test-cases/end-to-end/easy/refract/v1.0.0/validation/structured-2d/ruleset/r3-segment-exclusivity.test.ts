// Refract — ruleset/r3-segment-exclusivity: R3 Segment exclusivity.
//
// specs/beams.md R3: "Each segment carries at most one beam and is used at
// most once." Two poses, each on a private board built so R3 is the one rule
// the attempted move breaks (crystals are channel-neutral and keep spare
// charges, the segment is not the last one drawn so the move is no retract,
// and the crossing diagonal ledger is untouched):
//
//  - the SAME beam re-drawing a segment it already holds, reached by looping
//    the beam back to a crystal and extending across the already-used
//    crystal-to-crystal segment;
//  - a SECOND channel drawing the segment the first channel drew between the
//    same two crystals.
//
// Per the enforcement table a refused move leaves the beam unchanged and the
// trace live.

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
  type Harness,
} from "../harness";

/**
 * Private fixture — same-beam redraw. One triangle beam loops from T(0,0)
 * through both 2-charge crystals and back to the first: after
 * (0,0)-(1,0)-(2,0)-(3,0)-(2,1)-(1,1)-(1,0) the live end is the crystal at
 * (1,0), its predecessor is t(1,1), and the segment (1,0)-(2,0) is already
 * drawn — so extending to (2,0) re-uses a segment without being a retract,
 * while the crystal at (2,0) still holds a spare charge (1 of 2 spent).
 */
const R3_SAME_BEAM = `
T22t
.tt.
...T
`;

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

it("redrawing a segment the same beam already holds is refused", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R3_SAME_BEAM);

  const loop: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [2, 1],
    [1, 1],
    [1, 0],
  ];
  pressCell(h, { col: 0, row: 0 });
  for (const [col, row] of loop.slice(1)) moveToCell(h, { col, row });
  const drawn = toCells(loop);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    drawn,
    "the loop back to the crystal is drawn whole",
  );

  // From the crystal at (1,0), the segment to the crystal at (2,0) is already
  // part of this beam — used once already, so a second use is refused.
  moveToCell(h, { col: 2, row: 0 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    drawn,
    "re-drawing the beam's own segment is refused",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");
  h.debug.pointerUp();
});

it("a second channel drawing the same segment is refused", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R3_TWO_CHANNELS);

  // Triangle draws the crystal-to-crystal segment on its way across.
  h.debug.trace(
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
