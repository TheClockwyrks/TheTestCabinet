// Refract — board/silhouettes-distinct: the three channel silhouettes are told
// apart by form, not by hue alone.
//
// specs/board.md "Channels" pins the silhouettes — a triangle, a square, and a
// diamond — so channel identity reads by form as well as by hue. Conformance to
// the exact three shapes is the reviewer's, visible in the captured frame; what
// is decidable here without shape recognition is DISTINCTNESS, and that is all
// this suite asserts: one lens of each channel is posed on an otherwise empty
// board, each node's pixels within NODE_R (30) of its center are binarized
// against the background into a hue-independent mask, and every pair of masks
// overlaps by an intersection-over-union below 0.85 after centroid alignment.
// A build that drew the same blob in three hues scores near 1.0 on every pair
// and fails; three genuinely different forms clear the bar however they are
// styled.
//
// The lens is the FILLED silhouette (specs/board.md "Nodes"), so its mask is
// the form itself. The posed board is a LEGAL one — `loadBoard` poses a board
// as specs/board.md defines it, and every channel present must carry exactly
// two emitters — with each channel's emitters a full cell above and below its
// lens, well clear of the sampled NODE_R regions. The masks are binarized
// against the board's own ground (an empty cell's sample), because empty
// cells may legally carry quiet texture that is not part of any form.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R, type Channel } from "../notation";
import {
  groundSample,
  iouAfterAlignment,
  maskArea,
  maskRegion,
  readRegion,
} from "./pixels";

/** The item's overlap ceiling: at or above this, two forms read as one. */
const IOU_MAX = 0.85;

/**
 * One lens of each channel on the middle row, two cells apart, each channel's
 * two emitters directly above and below its own lens: legal, and every
 * sampled region a full CELL_PITCH from any other node.
 */
const LENS_ROW = `
T.S.D
t.s.d
T.S.D
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("draws three channel silhouettes no pair of which overlaps as one form", async () => {
  const board = await loadBoard(h, LENS_ROW);
  // One lens of each channel, side by side.
  captureStill(h, "nodes");

  const ground = groundSample(h, board);
  const masks: { channel: Channel; mask: boolean[] }[] = [];
  let size = 0;
  for (const node of board.nodes) {
    if (node.kind !== "lens") continue;
    const center = cellCenter(node.col, node.row, board.cols, board.rows);
    const region = readRegion(h, center.x, center.y, NODE_R);
    size = region.size;
    const mask = maskRegion(region, ground);
    // A silhouette that is not there at all cannot be told apart from anything;
    // an empty mask is its own verdict before any pair is compared.
    assertGreaterThan(
      maskArea(mask),
      0,
      `the ${String(node.channel)} lens draws a silhouette within NODE_R of ` +
        `its center`,
    );
    masks.push({ channel: node.channel as Channel, mask });
  }

  for (let i = 0; i < masks.length; i += 1) {
    for (let j = i + 1; j < masks.length; j += 1) {
      assertLessThan(
        iouAfterAlignment(masks[i].mask, masks[j].mask, size),
        IOU_MAX,
        `the ${masks[i].channel} and ${masks[j].channel} silhouettes, ` +
          `centroid-aligned, read as different forms`,
      );
    }
  }
});
