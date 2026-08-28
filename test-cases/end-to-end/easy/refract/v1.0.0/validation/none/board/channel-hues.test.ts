// board/channel-hues — the three channel hues are told apart at a glance.
//
// specs/board.md: each channel carries one distinct hue, and the three are
// told apart at a glance; the hues themselves are the build's to choose. So
// nothing here names a color — the reading is separation alone: one lens of
// each channel posed, each fill sampled at its cell center, and the three
// compared pairwise. The case's figure for "distinct" is more than 50 of the
// 441 the RGB cube spans.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { CHANNELS } from "../notation";
import { DISTINCT_MIN } from "./sampling";

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

it("gives the three channels pairwise distinct fill colors", async () => {
  const board = await loadBoard(h, THREE_LENSES);
  await captureStill(h, "channels");

  const fills: Rgb[] = [];
  for (const [index] of CHANNELS.entries()) {
    const at = center(board, { col: index * 2, row: 0 });
    fills.push(await sampleColor(h, at.x, at.y));
  }

  for (let a = 0; a < fills.length; a += 1) {
    for (let b = a + 1; b < fills.length; b += 1) {
      assertGreaterThan(
        colorDistance(fills[a], fills[b]),
        DISTINCT_MIN,
        `the ${CHANNELS[a]} fill against the ${CHANNELS[b]} fill`,
      );
    }
  }
});
