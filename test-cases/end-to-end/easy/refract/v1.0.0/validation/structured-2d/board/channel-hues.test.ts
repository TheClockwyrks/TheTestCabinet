// Refract — board/channel-hues: the three channel hues are told apart at a
// glance.
//
// specs/board.md "Channels": each channel carries one distinct hue, and the
// three are told apart at a glance — the hues themselves being the build's to
// choose. So the check fixes no palette: one lens of each channel is posed (the
// lens is the FILLED silhouette, so its form is the channel's hue laid on
// thick), each channel's hue is read off its lens, and every pair must differ
// by more than the item's 50 of 441 RGB distance. Three hues a glance can
// confuse — or one hue used thrice — fail on the pair that collides.
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
  resetTo,
  type Harness,
  type Rgb,
} from "../harness";
import { cellCenter, NODE_R, type Channel } from "../notation";
import { bodyColor, bodyMask, groundSample } from "./pixels";

/** The item's line: two hues told apart at a glance are this far apart. */
const APART_MIN = 50;

/**
 * One lens of each channel on the middle row, two cells apart, each channel's
 * two emitters directly above and below its own lens — a legal board
 * (specs/board.md: every channel present has exactly two emitters) whose
 * sampled lens centers sit a full CELL_PITCH from any other node.
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

it("draws the three channels' lenses with three pairwise distinct hues", async () => {
  const board = await loadBoard(h, LENS_ROW);
  // The three channel hues side by side.
  captureStill(h, "channels");

  const ground = groundSample(h, board);
  const fills: { channel: Channel; color: Rgb }[] = board.nodes
    .filter((node) => node.kind === "lens")
    .map((node) => {
      const center = cellCenter(node.col, node.row, board.cols, board.rows);
      return {
        channel: node.channel as Channel,
        color: bodyColor(bodyMask(h, center.x, center.y, NODE_R, ground)),
      };
    });

  for (let i = 0; i < fills.length; i += 1) {
    for (let j = i + 1; j < fills.length; j += 1) {
      assertGreaterThan(
        colorDistance(fills[i].color, fills[j].color),
        APART_MIN,
        `the ${fills[i].channel} and ${fills[j].channel} hues, read off ` +
          `their lens forms`,
      );
    }
  }
});
