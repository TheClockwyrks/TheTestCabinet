// Refract — board/channel-hues: the three channel hues are told apart at a
// glance.
//
// specs/board.md: each channel carries one distinct hue, and the three are
// told apart at a glance. The hues themselves are the build's to choose
// (Refract fixes no palette), so the check holds only the distance between
// them: one lens of each channel is posed, each fill is sampled at its cell
// center, and the three sampled colors must differ pairwise by more than 50
// of 441 RGB distance — the review item's figure, the checklist's own line
// for colors clearly apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { CHANNELS, type Channel } from "../notation";

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

it("fills the three channels' lenses in pairwise-distinct hues", async () => {
  await resetTo(h, 1);
  await loadBoard(h, LENS_BOARD);
  captureStill(h, "channels");

  const fills = new Map<Channel, Rgb>();
  for (const channel of CHANNELS) {
    const center = nodeCenter(LENS_COL[channel], LENS_ROW, COLS, ROWS);
    fills.set(channel, sampleColor(h, center.x, center.y));
  }

  for (let i = 0; i < CHANNELS.length; i += 1) {
    for (let j = i + 1; j < CHANNELS.length; j += 1) {
      const a = CHANNELS[i];
      const b = CHANNELS[j];
      assertGreaterThan(
        colorDistance(fills.get(a) as Rgb, fills.get(b) as Rgb),
        APART_MIN,
        `the ${a} and ${b} fills (specs/board.md: each channel carries one ` +
          "distinct hue, and the three are told apart at a glance)",
      );
    }
  }
});
