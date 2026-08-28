// board/crystal-distinct — a crystal is never mistaken for a channel node.
//
// specs/board.md: a crystal is drawn as a form clearly distinct from all three
// channel silhouettes. The form is the build's, so what is decided is
// distinctness alone, the same hue-independent reading as
// board/silhouettes-distinct: the crystal's pixels within NODE_R of its
// center, binarized against the bench into a mask, overlap each channel
// silhouette's mask by an intersection-over-union below 0.85 after centroid
// alignment. The captured frame shows the reviewer the four forms side by
// side.

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
import { iouAligned, maskOf, sampleDisk } from "./sampling";

/** A crystal and one lens of each channel on the top row; the required
 * emitters two rows below, a full 192 px from every sampled disk. */
const CRYSTAL_AND_LENSES = `
2.t.s.d
.......
TTSSDD.
`;

/** The item's ceiling on how alike two distinct forms may read. */
const IOU_MAX = 0.85;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("binarizes the crystal into a mask overlapping each channel silhouette below 0.85", async () => {
  const board = await loadBoard(h, CRYSTAL_AND_LENSES);
  await captureStill(h, "crystal");
  const bench = await sampleBench(h);

  const crystalAt = center(board, { col: 0, row: 0 });
  const crystal = maskOf(await sampleDisk(h, crystalAt.x, crystalAt.y), bench);
  // An empty mask would overlap everything by zero and pass; a crystal that
  // rendered nothing is a different failure, named here. specs/board.md draws
  // a crystal as a form of its own, showing its charges.
  assertGreaterThan(
    crystal.size,
    0,
    "the crystal renders a visible form within NODE_R of its center",
  );

  for (const [index, channel] of CHANNELS.entries()) {
    const at = center(board, { col: 2 + index * 2, row: 0 });
    const lens = maskOf(await sampleDisk(h, at.x, at.y), bench);
    assertGreaterThan(
      lens.size,
      0,
      `the ${channel} lens renders a visible form within NODE_R of its center`,
    );
    assertLessThan(
      iouAligned(crystal, lens),
      IOU_MAX,
      `mask overlap (IoU, centroid-aligned) of the crystal against the ${channel} silhouette`,
    );
  }
});
