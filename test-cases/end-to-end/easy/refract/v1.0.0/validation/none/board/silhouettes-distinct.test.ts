// board/silhouettes-distinct — the three channel silhouettes are told apart by
// form.
//
// specs/board.md pins the silhouettes — triangle, square, diamond — so channel
// identity reads by form as well as by hue, while the hues themselves are the
// build's. So the reading is hue-independent: each lens's pixels within NODE_R
// of its center, binarized against the bench into a mask, and the three masks
// compared pairwise by intersection-over-union after centroid alignment. Two
// genuinely different silhouettes overlap well below 0.85; three copies of one
// shape recolored overlap near 1. Whether each mask is exactly the triangle,
// the square, and the diamond is visible to the reviewer in the captured
// frame; what is decided here is the part decidable without shape
// recognition — that the three forms differ.
//
// The lenses sit on the top row, two cells apart, so each disk reads one
// form alone; the emitters every present channel must carry sit two rows
// below, a full 192 px from every sampled disk.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  sampleBench,
  type Harness,
} from "../harness";
import { CHANNELS } from "../notation";
import { iouAligned, maskOf, sampleDisk, type Mask } from "./sampling";

/** One lens of each channel on the top row; the required emitters below. */
const THREE_LENSES = `
t.s.d..
.......
TTSSDD.
`;

/** The item's ceiling on how alike two distinct silhouettes may read. */
const IOU_MAX = 0.85;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("binarizes the three lens silhouettes into masks that overlap below 0.85 pairwise", async () => {
  const board = await loadBoard(h, THREE_LENSES);
  await captureStill(h, "nodes");
  const bench = await sampleBench(h);

  const masks: Mask[] = [];
  for (const [index, channel] of CHANNELS.entries()) {
    const at = center(board, { col: index * 2, row: 0 });
    const disk = await sampleDisk(h, at.x, at.y);
    const mask = maskOf(disk, bench);
    // A mask with nothing in it is not a distinct silhouette, it is a lens
    // that never rendered a visible form at all — and an empty mask would
    // overlap everything by zero and pass. specs/board.md draws a lens as the
    // filled silhouette of its channel, so there is form here to compare.
    assertGreaterThan(
      mask.size,
      0,
      `the ${channel} lens renders a visible form within NODE_R of its center`,
    );
    masks.push(mask);
  }

  for (let a = 0; a < masks.length; a += 1) {
    for (let b = a + 1; b < masks.length; b += 1) {
      assertLessThan(
        iouAligned(masks[a], masks[b]),
        IOU_MAX,
        `mask overlap (IoU, centroid-aligned) of ${CHANNELS[a]} against ${CHANNELS[b]}`,
      );
    }
  }
});
