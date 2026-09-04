// Refract — board/silhouettes-distinct: the three channel silhouettes are told
// apart by form.
//
// specs/board.md pins the silhouettes — triangle, square, and diamond — so
// channel identity reads by form as well as by hue. Whether each form really
// IS a triangle, a square, and a diamond is visible to the reviewer in the
// captured frame; what a script can decide is distinctness, and that is what
// this suite decides: one lens of each channel is posed with nothing near it
// (its emitters parked two rows away — a channel present carries exactly two,
// specs/board.md), each lens's BODY within NODE_R (30) of its center is read,
// and each pair of bodies must overlap by an intersection-over-union below
// 0.85 after centroid alignment (the review item's figure). Three identical
// shapes in three hues binarize to the same body and fail; three genuinely
// different forms do not.
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

it("reads the three channel silhouettes as pairwise-distinct bodies", async () => {
  await resetTo(h, 1);
  await loadBoard(h, LENS_BOARD);
  captureStill(h, "nodes");

  const ground = groundSample(h, parseBoard(LENS_BOARD));
  const bodies = new Map<Channel, BodyMask>();
  for (const channel of CHANNELS) {
    const center = nodeCenter(LENS_COL[channel], LENS_ROW, COLS, ROWS);
    const body = bodyMask(h, center.x, center.y, NODE_R, ground);
    // A form with no pixels apart from the ground cannot read by form at all
    // (specs/board.md: channel identity reads by form as well as by hue).
    assertGreaterThan(
      bodyArea(body),
      0,
      `the ${channel} lens draws a visible silhouette within NODE_R (30) ` +
        "of its cell center",
    );
    bodies.set(channel, body);
  }

  for (let i = 0; i < CHANNELS.length; i += 1) {
    for (let j = i + 1; j < CHANNELS.length; j += 1) {
      const a = CHANNELS[i];
      const b = CHANNELS[j];
      assertLessThan(
        bodyIoU(bodies.get(a) as BodyMask, bodies.get(b) as BodyMask),
        IOU_MAX,
        `the ${a} and ${b} silhouettes overlap after centroid alignment ` +
          "(specs/board.md: the silhouettes are pinned, so channel identity " +
          "reads by form and not by hue alone)",
      );
    }
  }
});
