// Refract — board/crystal-spent-reads: a crystal's spent count reads from its
// form.
//
// specs/board.md "Nodes": a crystal carries 1 to MAX_CHARGES (3) charges and a
// running spent count, and the two read apart at a glance — the drawn form
// shows both, so a player tracks a crystal without counting segments. This
// point decides the spent half: the same crystal's region changes once a traced
// beam enters it and its spent count goes from 0 to 1 — the region within
// NODE_R (30) before the entry read against the region after it, sample by
// sample, differing somewhere by more than the item's 50 of 441 RGB distance.
//
// The entering beam is traced through the build's own pointer path
// (specs/instrumentation.md: trace is sugar over the pointer operations), and
// the snapshot's spent field going 0 to 1 is asserted as the arrangement the
// comparison reads (specs/beams.md: entering a crystal begins a crossing and
// spends a charge).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import { maxRegionDifference, readRegion } from "./pixels";

/** The item's line: over their samples the two regions differ this much. */
const DIFFER_MIN = 50;

/**
 * One channel across a 5x1 row: emitter, 1-charge crystal, gap, 3-charge
 * crystal, emitter. The beam T(0,0) -> (1,0) enters the 1-charge crystal.
 */
const TWO_CRYSTALS = "T1.3T";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("changes the crystal's region when a charge is spent", async () => {
  const board = await loadBoard(h, TWO_CRYSTALS);
  const one = cellCenter(1, 0, board.cols, board.rows);
  const before = readRegion(h, one.x, one.y, NODE_R);

  // A traced beam enters the 1-charge crystal, spending its charge.
  const spentAt = (): number | null | undefined =>
    h.snapshot().board.nodes.find((node) => node.col === 1 && node.row === 0)
      ?.spent;
  assertEqual(spentAt(), 0, "the crystal's spent count before the entry");
  h.debug.trace([
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  assertEqual(spentAt(), 1, "the crystal's spent count after the entry");

  await h.advance(1);
  // A crystal before and after a charge is spent: the after frame, the entered
  // crystal beside the untouched 3-charge one.
  captureStill(h, "spent");

  assertGreaterThan(
    maxRegionDifference(before, readRegion(h, one.x, one.y, NODE_R)),
    DIFFER_MIN,
    "the entered crystal's NODE_R region, before against after the spend",
  );
});
