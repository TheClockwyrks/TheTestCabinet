// board/crystal-charges-read — a crystal's charge count reads from its form.
//
// specs/board.md: a crystal carries 1 to MAX_CHARGES (3) charges and a running
// spent count, and its form shows both, readable without counting slowly. How
// it shows the charge count is the build's — pips, numerals, a dimming form —
// so the reading is that the RENDER moves with the number: a 1-charge and a
// 3-charge crystal differ within NODE_R of their centers. The regions are
// compared point against point, and the item's figure — more than 50 of 441 at
// some paired sample — is met where the differing detail is drawn.

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

/** A 1-charge and a 3-charge crystal, one cell between them. */
const ONE_AND_THREE = "1.3";

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

  const one = center(board, { col: 0, row: 0 });
  const three = center(board, { col: 2, row: 0 });
  const oneDisk = await sampleDisk(h, one.x, one.y);
  const threeDisk = await sampleDisk(h, three.x, three.y);

  assertGreaterThan(
    maxPairedDistance(oneDisk, threeDisk),
    DISTINCT_MIN,
    "the 1-charge region against the 3-charge region, point against point",
  );
});
