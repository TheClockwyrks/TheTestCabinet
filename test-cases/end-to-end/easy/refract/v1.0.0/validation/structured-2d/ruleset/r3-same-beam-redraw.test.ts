// Refract — ruleset/r3-same-beam-redraw: R3 Segment exclusivity, same beam.
//
// specs/beams.md R3: "Each segment carries at most one beam and is used at
// most once." The board below is private to this suite, built so R3 is the one
// rule the attempted move breaks (crystals are channel-neutral and keep spare
// charges, and the segment is not the last one drawn, so the move is no
// retract). Per the enforcement table a refused move leaves the beam unchanged
// and the trace live.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("redrawing a segment the same beam already holds is refused", async () => {
  await resetTo(h);
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

  // Evidence: the segment refused a second use.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
