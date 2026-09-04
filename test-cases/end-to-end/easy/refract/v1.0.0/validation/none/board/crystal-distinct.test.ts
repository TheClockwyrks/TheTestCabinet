// board/crystal-distinct — a crystal is never mistaken for a channel node.
//
// specs/board.md: a crystal is drawn as a form clearly distinct from all three
// channel silhouettes. The form is the build's, so what is decided is
// distinctness alone, the same hue-independent reading as
// board/silhouettes-distinct: the crystal's BODY within NODE_R of its center
// overlaps each channel silhouette's body by an intersection-over-union below
// 0.85 after centroid alignment. The captured frame shows the reviewer the four
// forms side by side.
//
// THE BODY IS BINARIZED RELATIVELY, at half the form's own strongest reading
// against the board's own ground. specs/board.md grants a build node artwork
// around the silhouette — "a halo, a backing, a highlight", item 4 of
// "Presentation is yours" — out to CELL_PITCH / 2 (48), and an absolute cut
// admits every pixel of a soft glow as silhouette, so three differently shaped
// forms wearing one glow read as one form. The relative cut reads the
// silhouettes the specification pins and leaves out the ornament it grants. It
// does not loosen the comparison: a build that draws all three channels as one
// square reads 1.000 under either cut.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { cellCenter, CHANNELS, NODE_R } from "../notation";
import { bodyArea, bodyIoU, bodyMask, groundSample } from "./sampling";

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

it("reads the crystal as a body overlapping each channel silhouette below 0.85", async () => {
  const board = await loadBoard(h, CRYSTAL_AND_LENSES);
  await captureStill(h, "crystal");
  const ground = await groundSample(h, board);

  const crystalAt = cellCenter(0, 0, board.cols, board.rows);
  const crystal = await bodyMask(h, crystalAt.x, crystalAt.y, NODE_R, ground);
  // An empty body would overlap everything by zero and pass; a crystal that
  // rendered nothing is a different failure, named here. specs/board.md draws
  // a crystal as a form of its own, showing its charges.
  assertGreaterThan(
    bodyArea(crystal),
    0,
    "the crystal renders a visible form within NODE_R of its center",
  );

  for (const [index, channel] of CHANNELS.entries()) {
    const at = cellCenter(2 + index * 2, 0, board.cols, board.rows);
    const lens = await bodyMask(h, at.x, at.y, NODE_R, ground);
    assertGreaterThan(
      bodyArea(lens),
      0,
      `the ${channel} lens renders a visible form within NODE_R of its center`,
    );
    assertLessThan(
      bodyIoU(crystal, lens),
      IOU_MAX,
      `body overlap (IoU, centroid-aligned) of the crystal against the ${channel} silhouette`,
    );
  }
});
