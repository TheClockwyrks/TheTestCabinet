// Refract — board/crystal-readout: a crystal shows its charges and how many
// are spent.
//
// specs/board.md "Nodes": a crystal carries 1 to MAX_CHARGES (3) charges and a
// running spent count, and the two read apart at a glance — the drawn form
// shows both, so a player tracks a crystal without counting segments. Two
// renderings decide it:
//
//   1. CHARGES: a 1-charge and a 3-charge crystal render differently. Their
//      regions within NODE_R (30) of their centers are compared sample by
//      sample, and somewhere over those samples the two must differ by more
//      than the item's 50 of 441 RGB distance — a build that draws every
//      charge count identically differs nowhere.
//   2. SPENT: the same crystal's region changes once a traced beam enters it
//      and its spent count goes from 0 to 1 — read the same way, the region
//      before the entry against the region after it.
//
// The entering beam is traced through the build's own pointer path
// (specs/instrumentation.md: trace is sugar over the pointer operations), and
// the snapshot's spent field going 0 to 1 is asserted as the arrangement the
// second comparison reads (specs/beams.md: entering a crystal begins a
// crossing and spends a charge).

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

it("renders 1 and 3 charges differently, and changes the region when a charge is spent", async () => {
  const board = await loadBoard(h, TWO_CRYSTALS);
  const one = cellCenter(1, 0, board.cols, board.rows);
  const three = cellCenter(3, 0, board.cols, board.rows);

  // CHARGES: the two charge counts render apart.
  const oneBefore = readRegion(h, one.x, one.y, NODE_R);
  const threeRegion = readRegion(h, three.x, three.y, NODE_R);
  assertGreaterThan(
    maxRegionDifference(oneBefore, threeRegion),
    DIFFER_MIN,
    "the 1-charge and 3-charge crystals' NODE_R regions, over their samples",
  );

  // SPENT: a traced beam enters the 1-charge crystal, spending its charge.
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
  const oneAfter = readRegion(h, one.x, one.y, NODE_R);
  assertGreaterThan(
    maxRegionDifference(oneBefore, oneAfter),
    DIFFER_MIN,
    "the entered crystal's NODE_R region, before against after the spend",
  );
});
