// Refract — board/crystal-distinct: a crystal is never mistaken for a channel
// node.
//
// specs/board.md: a crystal is drawn as a form clearly distinct from all three
// channel silhouettes — it is channel-neutral, and a player must never read it
// as a node of some channel. The check is the same body comparison
// silhouettes-distinct makes, crystal against each channel: one lens of each
// channel and one crystal are posed with nothing near them (the channels'
// emitters parked two rows away, as a board must carry them), each node's BODY
// within NODE_R (30) of its center is read, and the crystal's body must overlap
// each channel silhouette's body by an intersection-over-union below 0.85 after
// centroid alignment (the review item's figure).
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
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { CHANNELS, NODE_R, parseBoard, type Channel } from "../notation";
import {
  bodyArea,
  bodyIoU,
  bodyMask,
  groundSample,
  type BodyMask,
} from "./masks";

/** The review item's overlap ceiling after centroid alignment. */
const IOU_MAX = 0.85;

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

it("reads the crystal as a body distinct from every channel silhouette", async () => {
  await resetTo(h, 1);
  await loadBoard(h, CRYSTAL_BOARD);
  captureStill(h, "crystal");

  const ground = groundSample(h, parseBoard(CRYSTAL_BOARD));
  const bodyAt = (col: number, name: string): BodyMask => {
    const center = nodeCenter(col, NODE_ROW, COLS, ROWS);
    const body = bodyMask(h, center.x, center.y, NODE_R, ground);
    assertGreaterThan(
      bodyArea(body),
      0,
      `the ${name} draws a visible form within NODE_R (30) of its cell center`,
    );
    return body;
  };

  const crystal = bodyAt(CRYSTAL_COL, "crystal");
  for (const channel of CHANNELS) {
    const silhouette = bodyAt(LENS_COL[channel], `${channel} lens`);
    assertLessThan(
      bodyIoU(crystal, silhouette),
      IOU_MAX,
      `the crystal's body against the ${channel} silhouette after centroid ` +
        "alignment (specs/board.md: a crystal is a form clearly distinct " +
        "from all three channel silhouettes)",
    );
  }
});
