// Refract — board/crystal-distinct: a crystal is never mistaken for a channel
// node.
//
// specs/board.md: a crystal is drawn as a form clearly distinct from all three
// channel silhouettes — it is channel-neutral, and a player must never read it
// as a node of some channel. The check is the same mask comparison
// silhouettes-distinct makes, crystal against each channel: one lens of each
// channel and one crystal are posed with nothing near them (the channels'
// emitters parked two rows away, as a board must carry them), each node's
// pixels within NODE_R (30) of its center are binarized against the background
// into a hue-independent mask, and the crystal's mask must overlap each
// channel silhouette's mask by an intersection-over-union below 0.85 after
// centroid alignment (the review item's figure).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleBackground,
  type Harness,
} from "../harness";
import { CHANNELS, NODE_R, type Channel } from "../notation";
import { alignedIoU, silhouetteMask, type Mask } from "./masks";

/** The review item's overlap ceiling after centroid alignment. */
const IOU_MAX = 0.85;

/** The checklist's apart line, used to binarize a pixel against background. */
const APART_MIN = 50;

/**
 * A crystal beside one lens of each channel across the middle row, empty
 * cells between them; the emitter rows make every channel carry its two
 * emitters, as a board must (specs/board.md), while staying a full
 * CELL_PITCH from each sampled node.
 */
const CRYSTAL_BOARD = `
T.S.D..
t.s.d.1
T.S.D..
`;

/** The board's dimensions. */
const COLS = 7;
const ROWS = 3;

/** Where each channel's lens sits on CRYSTAL_BOARD. */
const LENS_COL: Readonly<Record<Channel, number>> = {
  triangle: 0,
  square: 2,
  diamond: 4,
};

/** Where the crystal sits, and the sampled nodes' shared row. */
const CRYSTAL_COL = 6;
const NODE_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("binarizes the crystal into a mask distinct from every channel silhouette", async () => {
  await resetTo(h, 1);
  await loadBoard(h, CRYSTAL_BOARD);
  captureStill(h, "crystal");

  const background = sampleBackground(h);
  const maskAt = (col: number, name: string): Mask => {
    const center = nodeCenter(col, NODE_ROW, COLS, ROWS);
    const mask = silhouetteMask(
      h,
      center.x,
      center.y,
      NODE_R,
      background,
      APART_MIN,
    );
    assertGreaterThan(
      mask.on.length,
      0,
      `the ${name} draws a visible form within NODE_R (30) of its cell center`,
    );
    return mask;
  };

  const crystal = maskAt(CRYSTAL_COL, "crystal");
  for (const channel of CHANNELS) {
    const silhouette = maskAt(LENS_COL[channel], `${channel} lens`);
    assertLessThan(
      alignedIoU(crystal, silhouette),
      IOU_MAX,
      `the crystal's mask against the ${channel} silhouette after centroid ` +
        "alignment (specs/board.md: a crystal is a form clearly distinct " +
        "from all three channel silhouettes)",
    );
  }
});
