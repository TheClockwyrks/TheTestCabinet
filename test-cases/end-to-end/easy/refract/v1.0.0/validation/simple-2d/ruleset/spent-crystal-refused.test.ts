// ruleset/spent-crystal-refused — the charge is spent on ENTRY, so a crystal
// a beam has entered and not yet left already refuses the next entry.
//
// specs/beams.md R5: "A crossing enters a crystal by one segment and leaves
// it by another. The charge is spent on entry and the crossing is completed
// by leaving, so a beam enters a crystal only while that crystal has an
// unspent charge, and a move into a crystal whose charges are all spent is
// refused." The board is the R5_SPENT_CRYSTAL fixture, `T1T / S.S`: the
// triangle beam is left ENDING on the 1-charge crystal — entered, not left,
// the crossing still open — and the square's diagonal into the crystal is the
// second entry the spent charge refuses.
//
// The probe is otherwise clean, so the spent charge is the only refusal: the
// crystal is channel-neutral (R2 clear), the diagonal is fresh and its block
// carries no other diagonal (R3 and R4 clear).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R5_SPENT_CRYSTAL } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R5_SPENT_CRYSTAL is `T1T / S.S`: 3 columns, 2 rows. */
const COLS = 3;
const ROWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, R5_SPENT_CRYSTAL);
});

afterEach(() => {
  h?.dispose();
});

it("refuses a second entry while a beam has entered and not yet left", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // The triangle beam enters the crystal and is released there: the charge
  // is spent on entry, and the crossing is begun and not completed.
  traceRoute(h, [
    [0, 0],
    [1, 0],
  ]);
  const entered = h.snapshot();
  assertDeepEqual(
    entered.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the triangle beam is left ending on the crystal",
  );
  const crystal = entered.board.nodes.find((n) => n.col === 1 && n.row === 0);
  assertEqual(crystal?.charges, 1, "the crystal carries 1 charge");
  assertEqual(
    crystal?.spent,
    1,
    "the charge is spent on entry, before the crossing is completed " +
      "(specs/beams.md R5)",
  );

  // The square's entry attempt: a move into a crystal whose charges are all
  // spent, even though the crossing that spent them is still open.
  h.debug.pointerDown(at(0, 1).x, at(0, 1).y);
  const before = h.snapshot();
  assertLiveTrace(
    before,
    "square",
    { col: 0, row: 1 },
    "the press on the square emitter begins the trace",
  );

  h.debug.pointerMove(at(1, 0).x, at(1, 0).y);
  const refused = h.snapshot();
  assertDeepEqual(
    refused.beams,
    before.beams,
    "R5: a 1-charge crystal a beam has entered and not yet left already " +
      "refuses a second entry by another beam — the beams are unchanged " +
      "(specs/beams.md: the charge is spent on entry)",
  );
  assertLiveTrace(
    refused,
    "square",
    { col: 0, row: 1 },
    "the refused entry leaves the trace live",
  );

  // Evidence: the spent crystal refusing a second entry, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
