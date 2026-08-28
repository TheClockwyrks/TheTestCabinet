// board/emitter-versus-lens — an emitter reads as outlined against a lens's
// fill.
//
// specs/board.md: an emitter and a lens of the same channel share one
// silhouette and differ only by outline against fill, so a player reads a
// node's channel and its role in the same glance. The palette is the build's,
// so the reading is structural: the lens's center cluster stands more than 50
// of 441 apart from the bench (the fill), while the emitter of the same
// channel is open at its center yet exceeds 50 somewhere on a sweep of radii
// inside NODE_R (the outline around that open center).
//
// "OPEN" IS READ AGAINST THE CELL'S OWN GROUND. An empty cell may carry quiet
// background texture of the build's choosing (specs/board.md), and an open
// center shows exactly that ground through the outline — so the emitter's
// center cluster is held within the item's 25 of 441 of an EMPTY CELL's
// center on the same board, the ground a cell shows when nothing fills it,
// rather than of the darkest far-off patch a legitimate board backdrop is
// allowed to sit apart from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleBench,
  sampleColor,
  type Harness,
} from "../harness";
import { NODE_R } from "../notation";
import { DISTINCT_MIN, MATCH_MAX, sweepMaxDistance } from "./sampling";

/**
 * Two triangle emitters, an empty cell, and a triangle lens: the outline, the
 * ground it is open onto, and the fill, all on one board.
 */
const EMITTER_GROUND_LENS = "T.tT";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fills the lens, and outlines the emitter around an open center", async () => {
  const board = await loadBoard(h, EMITTER_GROUND_LENS);
  await captureStill(h, "pair");
  const bench = await sampleBench(h);

  // The lens is filled: its center cluster stands apart from the bench.
  const lensAt = center(board, { col: 2, row: 0 });
  const lens = await sampleColor(h, lensAt.x, lensAt.y);
  assertGreaterThan(
    colorDistance(lens, bench),
    DISTINCT_MIN,
    "the lens's center cluster against the bench (the fill)",
  );

  // The emitter is open at its center: it shows the same ground an empty
  // cell of this board shows.
  const emitterAt = center(board, { col: 0, row: 0 });
  const groundAt = center(board, { col: 1, row: 0 });
  const emitterCenter = await sampleColor(h, emitterAt.x, emitterAt.y);
  const ground = await sampleColor(h, groundAt.x, groundAt.y);
  assertLessThanOrEqual(
    colorDistance(emitterCenter, ground),
    MATCH_MAX,
    "the emitter's center cluster against an empty cell's ground (open)",
  );

  // ...yet drawn: somewhere on the radius sweep inside NODE_R, its outline
  // stands apart from the bench.
  assertGreaterThan(
    await sweepMaxDistance(h, emitterAt, bench),
    DISTINCT_MIN,
    `the emitter's outline: the farthest swept pixel within NODE_R (${NODE_R}) of its center`,
  );
});
