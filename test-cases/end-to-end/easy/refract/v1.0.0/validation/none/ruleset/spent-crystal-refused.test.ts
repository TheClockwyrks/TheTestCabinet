// ruleset/spent-crystal-refused — the charge is spent on ENTRY and the
// crossing is completed by LEAVING (specs/beams.md R5), so a 1-charge crystal
// a beam has entered and not yet left already refuses a second entry.
//
// THE POSE. `R5_SPENT_CRYSTAL`:
//
//   T1T
//   S.S
//
// The triangle beam enters the crystal and is RELEASED there — a crossing
// begun and not completed, its charge already spent. The square trace, begun
// at S(0, 1), then attempts the diagonal into the crystal. If the charge were
// only spent when the crossing completes, the move would be legal; the
// specification spends it on entry, so the move is refused — and for no other
// reason (the segment is fresh, its diagonal's 2x2 block unused, the crystal
// channel-neutral).
//
// The snapshot's derived `spent` — "the crossings the drawn beams have BEGUN
// on it" (specs/instrumentation.md) — pins the precondition: one charge, one
// begun crossing, already spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R5_SPENT_CRYSTAL } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second entry into a 1-charge crystal a beam has entered and not yet left", async () => {
  const board = await loadBoard(h, R5_SPENT_CRYSTAL);

  // The triangle beam enters the crystal and is left there: crossing begun,
  // not completed, the only charge spent on entry.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);

  await pressAt(h, board, { col: 0, row: 1 });
  const before = await h.snapshot();
  const crystal = before.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(crystal?.charges, 1, "the crystal carries one charge");
  assertEqual(
    crystal?.spent,
    1,
    "the charge is already spent by the entry, before the crossing has left",
  );
  assertDeepEqual(
    before.tracing,
    { channel: "square", live: { col: 0, row: 1 } },
    "the press at S(0, 1) begins the square trace",
  );

  // The second entry, by another beam.
  await moveOver(h, board, { col: 1, row: 0 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the beam is unchanged by the entry into the spent crystal",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the trace stays live through the refused entry",
  );
});
