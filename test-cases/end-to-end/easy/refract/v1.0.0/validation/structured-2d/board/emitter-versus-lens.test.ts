// Refract — board/emitter-versus-lens: an emitter reads as outlined against a
// lens's fill.
//
// specs/board.md "Nodes": an emitter is the OUTLINED silhouette of its channel
// and a lens the FILLED one, sharing one form, so a player reads a node's
// channel and its role in the same glance. Outline against fill is decidable
// from three samples on one channel's pair of nodes:
//
//   1. the lens's center cluster is clearly apart from the background — the
//      item's 50 of 441 line — because a filled form covers its own center;
//   2. the emitter's center cluster stays within 25 of 441 of the background —
//      an outline is open in the middle;
//   3. yet somewhere on a radius sweep inside NODE_R (30) of the emitter's
//      center a pixel exceeds 50 of 441 — the outline itself is really drawn.
//
// "The background sample" here is the board's own GROUND — an empty cell's
// sample on the same frame — not the bare bench off the board:
// specs/board.md lets an empty cell carry quiet background texture, an open
// emitter center shows exactly the ground an empty cell shows, and against
// the off-board bench the 25 line would fail a conformant build for its
// legal texture while the 50 line still separates any drawn form from it.
//
// GEO_3X3 poses both roles of the triangle channel on one board: the emitter
// at (0, 0) and the lens at (1, 1).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  sampleColor,
  type Harness,
} from "../harness";
import { cellCenter } from "../notation";
import { groundSample, ringPoints } from "./pixels";

/** The item's line for a body clearly apart from the bench: 50 of 441. */
const APART_MIN = 50;

/** The item's line for a sample of bare bench: 25 of 441. */
const OPEN_MAX = 25;

/** The radii swept inside NODE_R, and the points sampled on each ring. */
const SWEEP_RADII = [8, 12, 16, 20, 24, 28];
const RING_SAMPLES = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("fills a lens, opens an emitter's center, and draws the emitter's outline", async () => {
  const board = await loadBoard(h, GEO_3X3);
  // An emitter and a lens of one channel.
  captureStill(h, "pair");

  const ground = groundSample(h, board);
  const lens = cellCenter(1, 1, board.cols, board.rows);
  const emitter = cellCenter(0, 0, board.cols, board.rows);

  // The fill: the lens covers its own center.
  assertGreaterThan(
    colorDistance(sampleColor(h, lens.x, lens.y), ground),
    APART_MIN,
    "the lens's center cluster, clearly apart from the background (filled)",
  );

  // The opening: the emitter's center shows the background through it.
  assertLessThanOrEqual(
    colorDistance(sampleColor(h, emitter.x, emitter.y), ground),
    OPEN_MAX,
    "the emitter's center cluster, within the background (open)",
  );

  // The outline: somewhere inside NODE_R the emitter is really drawn. Single
  // pixels rather than clusters, because an outline is a thin stroke a spread
  // cluster would dilute with the bench either side of it.
  let strongest = 0;
  for (const radius of SWEEP_RADII) {
    for (const point of ringPoints(
      emitter.x,
      emitter.y,
      radius,
      RING_SAMPLES,
    )) {
      const [r, g, b] = h.pixel(point.x, point.y);
      const d = colorDistance({ r, g, b }, ground);
      if (d > strongest) strongest = d;
    }
  }
  assertGreaterThan(
    strongest,
    APART_MIN,
    "some pixel on a radius sweep inside NODE_R of the emitter's center " +
      "(the outline)",
  );
});
