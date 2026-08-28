// Refract — board/silhouettes-distinct: the three channel silhouettes are told
// apart by form.
//
// specs/board.md pins the silhouettes — triangle, square, and diamond — so
// channel identity reads by form as well as by hue. Whether each form really
// IS a triangle, a square, and a diamond is visible to the reviewer in the
// captured frame; what a script can decide is distinctness, and that is what
// this suite decides: one lens of each channel is posed with nothing near it
// (its emitters parked two rows away — a channel present carries exactly two,
// specs/board.md), each lens's pixels within NODE_R (30) of its center are binarized
// against the background into a hue-independent mask, and each pair of masks
// must overlap by an intersection-over-union below 0.85 after centroid
// alignment (the review item's figure). Three identical shapes in three hues
// binarize to the same mask and fail; three genuinely different forms do not.

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
 * One lens of each channel across the middle row, empty cells between them.
 * The emitter rows above and below make the board a board at all — every
 * channel present carries exactly two emitters (specs/board.md), and
 * loadBoard holds a posed board to that — while every node's form fits
 * inside NODE_R (30) of its own center, so nothing a neighbour draws can
 * reach a sampled lens's box across the CELL_PITCH (96) gap.
 */
const LENS_BOARD = `
T.S.D
t.s.d
T.S.D
`;

/** The board's dimensions. */
const COLS = 5;
const ROWS = 3;

/** Where each channel's lens sits on LENS_BOARD. */
const LENS_COL: Readonly<Record<Channel, number>> = {
  triangle: 0,
  square: 2,
  diamond: 4,
};

/** The lenses' row. */
const LENS_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("binarizes the three channel silhouettes into pairwise-distinct masks", async () => {
  await resetTo(h, 1);
  await loadBoard(h, LENS_BOARD);
  captureStill(h, "nodes");

  const background = sampleBackground(h);
  const masks = new Map<Channel, Mask>();
  for (const channel of CHANNELS) {
    const center = nodeCenter(LENS_COL[channel], LENS_ROW, COLS, ROWS);
    const mask = silhouetteMask(
      h,
      center.x,
      center.y,
      NODE_R,
      background,
      APART_MIN,
    );
    // A form with no pixels apart from the background cannot read by form at
    // all (specs/board.md: channel identity reads by form as well as by hue).
    assertGreaterThan(
      mask.on.length,
      0,
      `the ${channel} lens draws a visible silhouette within NODE_R (30) ` +
        "of its cell center",
    );
    masks.set(channel, mask);
  }

  for (let i = 0; i < CHANNELS.length; i += 1) {
    for (let j = i + 1; j < CHANNELS.length; j += 1) {
      const a = CHANNELS[i];
      const b = CHANNELS[j];
      assertLessThan(
        alignedIoU(masks.get(a) as Mask, masks.get(b) as Mask),
        IOU_MAX,
        `the ${a} and ${b} silhouettes overlap after centroid alignment ` +
          "(specs/board.md: the silhouettes are pinned, so channel identity " +
          "reads by form and not by hue alone)",
      );
    }
  }
});
