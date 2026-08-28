// Refract — board/node-radius: every node fits inside NODE_R of its cell
// center.
//
// specs/board.md: every node's drawn form fits inside NODE_R (30) of its cell
// center, so neighboring nodes — a full CELL_PITCH (96) apart — never collide.
// The reading is a ring swept just outside that radius, at NODE_R + 4 from a
// single posed node's center: every pixel on it must match the background
// sample within the item's 25 of 441 RGB distance. The +4 leaves the build's
// anti-aliasing its edge pixels while still failing any form that really
// spills.
//
// One node of each kind is swept, because the three kinds carry the three
// different drawings — an outline, a fill, and a crystal's charge readout —
// and each must stay inside the radius on its own. Each sits on a legal board
// (specs/board.md: every channel present has exactly two emitters), the swept
// node's nearest neighbor two full cells away, so nothing else can reach the
// ring. "The background sample" is the board's own ground — an empty cell's
// sample on the same frame — because specs/board.md lets empty cells carry
// quiet background texture, and the ring at NODE_R + 4 sits inside the node's
// own cell, on that ground.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import { groundSample, ringPoints } from "./pixels";

/** The item's line for a ring pixel that matches the background: 25 of 441. */
const MATCH_MAX = 25;

/** The ring just outside the radius every form must fit inside. */
const RING_R = NODE_R + 4;

/** How many pixels the ring is sampled at: about one per 4.5 degrees. */
const RING_SAMPLES = 80;

/**
 * The three kinds, each posed on a legal one-channel board with the swept
 * node — the leftmost, at (0, 0) — two full cells from its nearest neighbor.
 */
const SWEPT_NODES = [
  { name: "an emitter", notation: "T.T", swept: { col: 0, row: 0 } },
  { name: "a lens", notation: "t.T.T", swept: { col: 0, row: 0 } },
  { name: "a 3-charge crystal", notation: "3.T.T", swept: { col: 0, row: 0 } },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it.each(SWEPT_NODES)(
  "keeps $name inside NODE_R of its cell center",
  async ({ name, notation, swept }) => {
    const board = await loadBoard(h, notation);
    if (notation === "3.T.T") {
      // The node inside its radius: the crystal, the kind whose drawing
      // carries the most — its form, its charges, and its spent count.
      captureStill(h, "node");
    }

    const ground = groundSample(h, board);
    const center = cellCenter(swept.col, swept.row, board.cols, board.rows);
    for (const point of ringPoints(center.x, center.y, RING_R, RING_SAMPLES)) {
      const [r, g, b] = h.pixel(point.x, point.y);
      assertLessThanOrEqual(
        colorDistance({ r, g, b }, ground),
        MATCH_MAX,
        `${name}: the ring pixel at (${point.x.toFixed(1)}, ` +
          `${point.y.toFixed(1)}), NODE_R + 4 from the center`,
      );
    }
  },
);
