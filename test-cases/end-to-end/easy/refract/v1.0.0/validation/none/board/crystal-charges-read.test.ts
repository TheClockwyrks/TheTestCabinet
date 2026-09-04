// board/crystal-charges-read — a crystal's charge count reads from its form.
//
// specs/board.md: a crystal carries 1 to MAX_CHARGES (3) charges and a running
// spent count, and its form shows both, readable without counting slowly. How
// it shows the charge count is the build's — pips, numerals, a dimming form —
// so the reading is that the RENDER moves with the number: a 1-charge and a
// 3-charge crystal differ within NODE_R of their centers. The regions are
// compared point against point, and the item's figure — more than 50 of 441 at
// some paired sample — is met where the differing detail is drawn.
//
// THE POSE. "T1.3T": one channel across a 5x1 row — the two triangle emitters
// the board has to declare (specs/board.md "Channels": a board declares 1 to 3
// channels) at the ends, the 1-charge and the 3-charge crystal between them,
// one cell apart. The emitters sit a full CELL_PITCH (96) from either sampled
// center, so their forms — NODE_R (30), plus the ornament specs/board.md
// grants out to CELL_PITCH / 2 (48) — stay clear of both sampled disks.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { DISTINCT_MIN, maxPairedDistance, sampleDisk } from "./sampling";

/**
 * One channel across a 5x1 row: emitters at the ends, a 1-charge and a
 * 3-charge crystal between them, one cell apart.
 */
const ONE_AND_THREE = "T1.3T";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("renders a 1-charge and a 3-charge crystal differently", async () => {
  const board = await loadBoard(h, ONE_AND_THREE);
  await captureStill(h, "charges");

  const one = center(board, { col: 1, row: 0 });
  const three = center(board, { col: 3, row: 0 });
  const oneDisk = await sampleDisk(h, one.x, one.y);
  const threeDisk = await sampleDisk(h, three.x, three.y);

  assertGreaterThan(
    maxPairedDistance(oneDisk, threeDisk),
    DISTINCT_MIN,
    "the 1-charge region against the 3-charge region, point against point",
  );
});
