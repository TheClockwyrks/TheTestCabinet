// Refract — board/node-radius: every node fits inside NODE_R of its cell
// center.
//
// specs/board.md: every node's drawn form fits inside NODE_R (30) of its cell
// center, so neighboring nodes never collide. The check poses the one board
// that isolates a single node completely — SINGLE_1X1, one crystal on a 1x1
// board, its center on (BOARD_CX, BOARD_CY) — and sweeps the ring at
// NODE_R + 4: every pixel there must match the background sample within 25 of
// 441 RGB distance (the review item's figures). The crystal is the node with
// the most to draw (its charge and spent readout), so it is the form most
// likely to spill.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { SINGLE_1X1 } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleBackground,
  type Harness,
  type Rgb,
} from "../harness";
import { NODE_R } from "../notation";

/** The review item's tolerance: the ring reads as the background. */
const MATCH_MAX = 25;

/** The review item's ring: just outside the radius every form fits inside. */
const RING_R = NODE_R + 4;

/** Pixels sampled around the ring — a step of under 3 px of arc. */
const RING_STEPS = 96;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The single rendered pixel at a logical point, as an Rgb. */
function pixelColor(x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

it("keeps the posed node's whole form inside NODE_R of its center", async () => {
  await resetTo(h, 1);
  await loadBoard(h, SINGLE_1X1);
  captureStill(h, "node");

  const background = sampleBackground(h);
  const center = nodeCenter(0, 0, 1, 1);

  for (let step = 0; step < RING_STEPS; step += 1) {
    const angle = (2 * Math.PI * step) / RING_STEPS;
    const x = center.x + RING_R * Math.cos(angle);
    const y = center.y + RING_R * Math.sin(angle);
    assertLessThanOrEqual(
      colorDistance(pixelColor(x, y), background),
      MATCH_MAX,
      `the ring at NODE_R + 4 (${RING_R}) from the cell center, at angle ` +
        `${step}/${RING_STEPS} — specs/board.md: every node's drawn form ` +
        "fits inside NODE_R (30)",
    );
  }
});
