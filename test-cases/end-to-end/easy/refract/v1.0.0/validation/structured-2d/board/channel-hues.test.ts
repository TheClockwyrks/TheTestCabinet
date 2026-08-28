// Refract — board/channel-hues: the three channel hues are told apart at a
// glance.
//
// specs/board.md "Channels": each channel carries one distinct hue, and the
// three are told apart at a glance — the hues themselves being the build's to
// choose. So the check fixes no palette: one lens of each channel is posed
// (the lens is the FILLED silhouette, so its center cluster is the channel's
// hue laid on thick), the three fills are sampled, and every pair must differ
// by more than the item's 50 of 441 RGB distance. Three hues a glance can
// confuse — or one hue used thrice — fail on the pair that collides.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { cellCenter, type Channel } from "../notation";

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

it("fills the three channels' lenses with three pairwise distinct hues", async () => {
  const board = await loadBoard(h, LENS_ROW);
  // The three channel hues side by side.
  captureStill(h, "channels");

  const fills: { channel: Channel; color: Rgb }[] = board.nodes
    .filter((node) => node.kind === "lens")
    .map((node) => {
      const center = cellCenter(node.col, node.row, board.cols, board.rows);
      return {
        channel: node.channel as Channel,
        color: sampleColor(h, center.x, center.y),
      };
    });

  for (let i = 0; i < fills.length; i += 1) {
    for (let j = i + 1; j < fills.length; j += 1) {
      assertGreaterThan(
        colorDistance(fills[i].color, fills[j].color),
        APART_MIN,
        `the ${fills[i].channel} and ${fills[j].channel} fills, sampled at ` +
          `their lens centers`,
      );
    }
  }
});
