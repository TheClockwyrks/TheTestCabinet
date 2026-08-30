// board/channel-hues — the three channel hues are told apart at a glance.
//
// specs/board.md: each channel carries one distinct hue, and the three are
// told apart at a glance; the hues themselves are the build's to choose. So
// nothing here names a color — the reading is separation alone: one lens of
// each channel posed, each channel's hue read as the median color of its
// lens's form, and the three compared pairwise. The case's figure for
// "distinct" is more than 50 of the 441 the RGB cube spans.
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
  type Harness,
  type Rgb,
} from "../harness";
import { cellCenter, CHANNELS, NODE_R } from "../notation";
import { bodyColor, bodyMask, DISTINCT_MIN, groundSample } from "./sampling";

/** One lens of each channel on the top row; the required emitters below. */
const THREE_LENSES = `
t.s.d..
.......
TTSSDD.
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives the three channels pairwise distinct hues", async () => {
  const board = await loadBoard(h, THREE_LENSES);
  await captureStill(h, "channels");
  const ground = await groundSample(h, board);

  const fills: Rgb[] = [];
  for (const [index] of CHANNELS.entries()) {
    const at = cellCenter(index * 2, 0, board.cols, board.rows);
    fills.push(bodyColor(await bodyMask(h, at.x, at.y, NODE_R, ground)));
  }

  for (let a = 0; a < fills.length; a += 1) {
    for (let b = a + 1; b < fills.length; b += 1) {
      assertGreaterThan(
        colorDistance(fills[a], fills[b]),
        DISTINCT_MIN,
        `the ${CHANNELS[a]} hue against the ${CHANNELS[b]} hue`,
      );
    }
  }
});
