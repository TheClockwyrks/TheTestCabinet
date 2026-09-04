// Refract — board/crystal-charges-read: a crystal's charge count reads from
// its form.
//
// specs/board.md "Nodes": a crystal carries 1 to MAX_CHARGES (3) charges and a
// running spent count, and the two read apart at a glance — the drawn form
// shows both, so a player tracks a crystal without counting segments. This
// point decides the charge half: a 1-charge and a 3-charge crystal render
// differently. Their regions within NODE_R (30) of their centers are compared
// sample by sample, and somewhere over those samples the two must differ by
// more than the item's 50 of 441 RGB distance — a build that draws every charge
// count identically differs nowhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
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
 * crystal, emitter.
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

it("renders 1 and 3 charges differently", async () => {
  const board = await loadBoard(h, TWO_CRYSTALS);
  const one = cellCenter(1, 0, board.cols, board.rows);
  const three = cellCenter(3, 0, board.cols, board.rows);

  // A 1-charge and a 3-charge crystal side by side.
  captureStill(h, "charges");

  assertGreaterThan(
    maxRegionDifference(
      readRegion(h, one.x, one.y, NODE_R),
      readRegion(h, three.x, three.y, NODE_R),
    ),
    DIFFER_MIN,
    "the 1-charge and 3-charge crystals' NODE_R regions, over their samples",
  );
});
