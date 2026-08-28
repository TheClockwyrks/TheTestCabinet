// ruleset/r5-crystal-capacity — R5: a crystal carrying n charges is crossed
// at most n times.
//
// The board is the CRYSTAL_TWICE fixture — a lone triangle beam that must
// cross the 2-charge crystal at (1,1) twice to spend both charges. The beam
// runs T(0,0) into the crystal, out to t(0,2), around by t(1,2) back in, and
// out through t(2,1) to t(1,0), all in one live trace: two crossings begun
// and completed, both charges spent. The probe is the vertical from the live
// end t(1,0) onto the crystal — the crossing after the n-th — and R5 refuses
// it: "a move into a crystal whose charges are all spent is refused"
// (specs/beams.md).
//
// The probe segment is fresh (R3 clear), not a diagonal (R4 clear), the
// crystal is channel-neutral (R2 clear), t(1,0) would only reach its second
// segment (lens capacity clear), and the node behind the live end is t(2,1),
// so this is an extension attempt rather than a retract (specs/controls.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CRYSTAL_TWICE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** CRYSTAL_TWICE is `Tt.T / .2t. / tt..`: 4 columns, 3 rows. */
const COLS = 4;
const ROWS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, CRYSTAL_TWICE);
});

afterEach(() => {
  h?.dispose();
});

it("refuses the crossing after the n-th of an n-charge crystal", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  for (const [col, row] of [
    [1, 1],
    [0, 2],
    [1, 2],
    [1, 1],
    [2, 1],
    [1, 0],
  ] as const) {
    h.debug.pointerMove(at(col, row).x, at(col, row).y);
  }
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 2 },
      { col: 1, row: 2 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 1, row: 0 },
    ],
    "the beam crosses the crystal twice and stands at t(1,0) " +
      "(specs/beams.md permits every segment of it)",
  );
  const crystal = before.board.nodes.find((n) => n.col === 1 && n.row === 1);
  assertEqual(crystal?.charges, 2, "the crystal carries 2 charges");
  assertEqual(
    crystal?.spent,
    2,
    "both charges are spent by the two crossings (specs/beams.md: the " +
      "charge is spent on entry)",
  );

  // The probe: a third crossing of the 2-charge crystal.
  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const refused = h.snapshot();
  assertDeepEqual(
    refused.beams,
    before.beams,
    "R5: a crystal carrying n charges is crossed at most n times — the " +
      "crossing after the n-th is refused and the beam is unchanged " +
      "(specs/beams.md)",
  );
  assertLiveTrace(
    refused,
    "triangle",
    { col: 1, row: 0 },
    "the refused crossing leaves the trace live",
  );

  // Evidence: the crystal refusing a crossing past its charges, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
