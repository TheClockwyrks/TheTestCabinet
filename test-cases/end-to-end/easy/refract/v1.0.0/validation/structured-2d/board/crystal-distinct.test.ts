// Refract — board/crystal-distinct: a crystal is never mistaken for a channel
// node.
//
// specs/board.md "Nodes": a crystal is drawn as a form clearly distinct from
// all three channel silhouettes — it is channel-neutral, and a player who read
// it as a triangle, square, or diamond would look for a beam that owns it. The
// mechanical reading is the same mask comparison as silhouettes-distinct, with
// the crystal on one side of every pair: its pixels within NODE_R (30) of its
// center, binarized against the background into a hue-independent mask, must
// overlap each channel silhouette's mask by an intersection-over-union below
// 0.85 after centroid alignment.
//
// One lens per channel and one crystal share the middle row of a legal board
// (each channel's two emitters sit directly above and below its lens), so all
// four masks come off one frame; the lens is each channel's FILLED
// silhouette, the form itself. Masks are binarized against the board's own
// ground (an empty cell's sample), because empty cells may legally carry
// quiet texture that is not part of any form.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import {
  groundSample,
  iouAfterAlignment,
  maskArea,
  maskRegion,
  readRegion,
} from "./pixels";

/** The item's overlap ceiling: at or above this, two forms read as one. */
const IOU_MAX = 0.85;

/** One lens per channel and a 2-charge crystal, two cells apart on one row. */
const LINE_UP = `
T.S.D..
t.s.d.2
T.S.D..
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("draws a crystal that overlaps no channel silhouette as one form", async () => {
  const board = await loadBoard(h, LINE_UP);
  // A crystal beside the three channel nodes.
  captureStill(h, "crystal");

  const ground = groundSample(h, board);
  const masks = board.nodes
    .filter((node) => node.kind !== "emitter")
    .map((node) => {
      const center = cellCenter(node.col, node.row, board.cols, board.rows);
      const region = readRegion(h, center.x, center.y, NODE_R);
      return {
        name: node.kind === "crystal" ? "crystal" : String(node.channel),
        kind: node.kind,
        size: region.size,
        mask: maskRegion(region, ground),
      };
    });
  for (const { name, mask } of masks) {
    // A form that is not there at all cannot be told apart from anything; an
    // empty mask is its own verdict before any pair is compared.
    assertGreaterThan(
      maskArea(mask),
      0,
      `the ${name} node draws a form within NODE_R of its center`,
    );
  }

  const crystal = masks.find((entry) => entry.kind === "crystal");
  if (crystal === undefined) throw new Error("the posed row holds a crystal");
  for (const lens of masks.filter((entry) => entry.kind === "lens")) {
    assertLessThan(
      iouAfterAlignment(crystal.mask, lens.mask, crystal.size),
      IOU_MAX,
      `the crystal and the ${lens.name} silhouette, centroid-aligned, read ` +
        `as different forms`,
    );
  }
});
