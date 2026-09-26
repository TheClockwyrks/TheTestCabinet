// Refract — ruleset/refusal-is-silent: a refused move changes nothing and
// keeps the trace live.
//
// specs/beams.md, Enforcement: "A move that would break one is refused: the
// beam is unchanged and the trace stays live", and specs/controls.md,
// Extending: "A move those rules refuse changes nothing and the trace stays
// live, so a player can sweep the pointer across the board and draw only
// permitted segments." On R2_FOREIGN the live triangle trace at t(1,0) is
// swept across three illegal targets in turn — the empty cell (0,1), the
// foreign lens s(1,1), and the empty cell (2,1) — and after every one the beam
// is identical in the snapshot and the trace still live. A frame runs between
// the moves so the replay shows the sweep drawing nothing; the moves
// themselves resolve at the call (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a sweep across three illegal targets draws nothing and stays live", async () => {
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);

  const drawn = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ];
  const illegal: ReadonlyArray<{ col: number; row: number }> = [
    { col: 0, row: 1 }, // an empty cell: no node to extend to (R1)
    { col: 1, row: 1 }, // the square lens: another channel's node (R2)
    { col: 2, row: 1 }, // an empty cell again (R1)
  ];

  await captureReplay(h, "sweep", async () => {
    // The live trace: T(0,0) extended to t(1,0).
    pressCell(h, { col: 0, row: 0 });
    moveToCell(h, { col: 1, row: 0 });
    assertDeepEqual(
      h.snapshot().beams.triangle?.cells,
      drawn,
      "the permitted segment is drawn before the sweep",
    );
    await h.advance(1);

    for (const [index, target] of illegal.entries()) {
      moveToCell(h, target);
      const snap = h.snapshot();
      assertDeepEqual(
        snap.beams.triangle?.cells,
        drawn,
        `the beam is identical after illegal target ${index + 1} at (${target.col}, ${target.row})`,
      );
      assertNotNull(
        snap.tracing,
        `the trace is live after illegal target ${index + 1}`,
      );
      assertDeepEqual(
        snap.tracing?.live,
        { col: 1, row: 0 },
        `the live end has not moved after illegal target ${index + 1}`,
      );
      // The frame that renders the unchanged board into the replay.
      await h.advance(1);
      assertDeepEqual(
        h.snapshot().beams.triangle?.cells,
        drawn,
        `the beam is still identical a frame after illegal target ${index + 1}`,
      );
    }
  });

  h.debug.pointerUp();
});
