// Refract — board/channel-hues: the three channel hues are told apart at a
// glance.
//
// specs/board.md: each channel carries one distinct hue, and the three are
// told apart at a glance. The hues themselves are the build's to choose
// (Refract fixes no palette), so the check holds only the distance between
// them: one lens of each channel is posed, each channel's hue is read as the
// median color of its lens's form, and the three colors must differ pairwise
// by more than 50 of 441 RGB distance — the review item's figure, the
// checklist's own line for colors clearly apart.
//
// WHERE A HUE IS READ. Not at the lens's exact center pixel: specs/board.md
// fixes that the three hues are distinct, and fixes nothing about where inside
// a node its hue is shown, so a build that lays an optical iris, a socket, or a
// bevel over the middle of its filled silhouette shows all three of its centers
// in one ornament color and reads as having no hues at all. Nor at the form's
// loudest pixel, which is the same trap through the other door: the pixel
// standing farthest from the ground is whatever the node wears that is most
// extreme against the board — on a dark board a white specular pip or a white
// outline — so three lenses wearing the same pip would again report one color
// and fail for an ornament rather than for a hue. Each channel's hue is read
// instead as the MEDIAN color of its lens's body, the color the form is mostly
// made of, which no ornament covering a minority of it can move.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
  type Rgb,
} from "../harness";
import { CHANNELS, NODE_R, parseBoard, type Channel } from "../notation";
import { bodyColor, bodyMask, groundSample } from "./masks";

/** The review item's distance: hues clearly apart on the 0–441 RGB scale. */
const APART_MIN = 50;

/**
 * One lens of each channel across the middle row, empty cells between them;
 * the emitter rows make every channel carry its two emitters, as a board
 * must (specs/board.md), while staying a full CELL_PITCH from each sampled
 * lens.
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

it("draws the three channels' lenses in pairwise-distinct hues", async () => {
  await resetTo(h, 1);
  await loadBoard(h, LENS_BOARD);
  captureStill(h, "channels");

  const ground = groundSample(h, parseBoard(LENS_BOARD));
  const fills = new Map<Channel, Rgb>();
  for (const channel of CHANNELS) {
    const center = nodeCenter(LENS_COL[channel], LENS_ROW, COLS, ROWS);
    fills.set(
      channel,
      bodyColor(bodyMask(h, center.x, center.y, NODE_R, ground)),
    );
  }

  for (let i = 0; i < CHANNELS.length; i += 1) {
    for (let j = i + 1; j < CHANNELS.length; j += 1) {
      const a = CHANNELS[i];
      const b = CHANNELS[j];
      assertGreaterThan(
        colorDistance(fills.get(a) as Rgb, fills.get(b) as Rgb),
        APART_MIN,
        `the ${a} and ${b} hues (specs/board.md: each channel carries one ` +
          "distinct hue, and the three are told apart at a glance)",
      );
    }
  }
});
