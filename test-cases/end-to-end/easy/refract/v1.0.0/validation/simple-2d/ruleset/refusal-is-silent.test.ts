// ruleset/refusal-is-silent — a refused move changes nothing and keeps the
// trace live, sweep after sweep.
//
// specs/controls.md (Extending): "A move those rules refuse changes nothing
// and the trace stays live, so a player can sweep the pointer across the
// board and draw only permitted segments." The board is the R2_FOREIGN
// fixture with the square's beam fully drawn (S(0,2)-s(1,1)-S(2,2), two
// diagonals of different blocks); the triangle trace then begins at T(0,0)
// and sweeps across three illegal targets in one held gesture:
//
//   1. s(1,1)  — the square's lens, refused by R2;
//   2. T(2,0)  — two columns from the live end, refused by R1;
//   3. S(2,2)  — non-adjacent (and foreign), refused by R1.
//
// After every one of the three, the beams are identical to the snapshot taken
// at the press — byte for byte, both channels — and the trace is still live
// at T(0,0). The release then puts the board back to what it was before the
// gesture: a trace that added no segment leaves its channel's beam carrying
// none (specs/controls.md), so nothing the sweep crossed survives. The declared
// `sweep` replay records the frames the build drew while the sweep ran;
// frames are advanced between the poses so the recording shows the board
// holding still, and it is evidence beside the verdict, never part of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R2_FOREIGN is `TtT / .s. / S.S`: 3 columns, 3 rows. */
const COLS = 3;
const ROWS = 3;

/** The three illegal targets the sweep crosses, and the rule refusing each. */
const TARGETS: readonly {
  col: number;
  row: number;
  why: string;
}[] = [
  { col: 1, row: 1, why: "the square's lens (R2)" },
  { col: 2, row: 0, why: "a node two columns from the live end (R1)" },
  { col: 2, row: 2, why: "a non-adjacent foreign emitter (R1)" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, R2_FOREIGN);
});

afterEach(() => {
  h?.dispose();
});

it("leaves the beam identical and the trace live across three illegal targets", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // The square's beam is drawn and released first, so the sweep has a foreign
  // lens to cross and a second channel whose beam must also hold still.
  traceRoute(h, [
    [0, 2],
    [1, 1],
    [2, 2],
  ]);

  // The board before the gesture: what everything must still equal once the
  // trace that added no segment is released (specs/controls.md: such a trace
  // leaves its channel's beam carrying none).
  const baseline = h.snapshot();

  await captureReplay(h, "sweep", async () => {
    h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
    await h.advance(3);
    const before = h.snapshot();
    assertLiveTrace(
      before,
      "triangle",
      { col: 0, row: 0 },
      "the press on the triangle emitter begins the trace",
    );

    for (const target of TARGETS) {
      h.debug.pointerMove(
        at(target.col, target.row).x,
        at(target.col, target.row).y,
      );
      const swept = h.snapshot();
      assertDeepEqual(
        swept.beams,
        before.beams,
        `the sweep onto ${target.why} leaves the beam identical in the ` +
          "snapshot (specs/controls.md: a refused move changes nothing)",
      );
      assertLiveTrace(
        swept,
        "triangle",
        { col: 0, row: 0 },
        `the sweep onto ${target.why} keeps the trace live`,
      );
      await h.advance(3);
    }

    h.debug.pointerUp();
    await h.advance(3);
    assertDeepEqual(
      h.snapshot().beams,
      baseline.beams,
      "the released trace added no segment, so the beams match the board " +
        "before the gesture — nothing the sweep crossed was drawn " +
        "(specs/controls.md)",
    );
  });
});
