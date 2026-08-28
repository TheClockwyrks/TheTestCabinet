// board/node-radius — every node fits inside NODE_R of its cell center.
//
// specs/board.md: every node's drawn form fits inside NODE_R (30) of its cell
// center, so neighboring nodes never collide. The reading is a ring of single
// pixels at NODE_R plus 4 around one posed node — outside the permitted form
// with room for a conformant edge's anti-aliasing — each of which must still
// be bare bench, within the case's 25 of 441 for "matches".
//
// The node is a lone crystal on a 1x1 board: the degenerate grid puts its one
// cell center on (BOARD_CX, BOARD_CY) exactly, the fit inside NODE_R is
// demanded of every node kind alike, and a crystal is the one node a 1x1
// notation can pose alone — a lens or emitter would declare a channel, and a
// channel present carries exactly two emitters (specs/board.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleBench,
  type Harness,
} from "../harness";
import { NODE_R } from "../notation";
import { MATCH_MAX } from "./sampling";

/** A single 1-charge crystal, alone on a 1x1 board. */
const LONE_NODE = "1";

/** The ring's radius: just past the box the form must fit inside. */
const RING_R = NODE_R + 4;

/** How many single pixels the ring is read at: one per ten degrees. */
const RING_POINTS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the ring at NODE_R + 4 bare bench all the way around`, async () => {
  const board = await loadBoard(h, LONE_NODE);
  await captureStill(h, "node");
  const bench = await sampleBench(h);
  const at = center(board, { col: 0, row: 0 });

  const points = Array.from({ length: RING_POINTS }, (_, step) => {
    const angle = (step / RING_POINTS) * 2 * Math.PI;
    return {
      x: at.x + RING_R * Math.cos(angle),
      y: at.y + RING_R * Math.sin(angle),
    };
  });
  const read = await h.pixels(points);

  for (const [index, [r, g, b]] of read.entries()) {
    assertLessThanOrEqual(
      colorDistance({ r, g, b }, bench),
      MATCH_MAX,
      `the ring pixel at ${(index * 360) / RING_POINTS} degrees, ${RING_R} px from the cell center`,
    );
  }
});
