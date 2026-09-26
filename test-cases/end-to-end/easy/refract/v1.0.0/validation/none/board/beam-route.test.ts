// board/beam-route — a drawn beam visibly connects the cells it links.
//
// specs/board.md: a drawn beam visibly connects the centers of the cells it
// links, so its route is unambiguous. The rendering is the build's, so the
// reading is at the geometry the spec fixes: the midpoint of an orthogonal and
// of a diagonal segment, on two different channels — the point every straight
// center-to-center segment passes through, comfortably clear of the node forms
// at either end.
//
// THE COMPARAND IS THE SAME POINT WITH THE BEAM EMPTY. Each midpoint is read
// twice on the same posed board: once with no segment traced and once with the
// segment drawn, both one advanced frame after the state they read. Nothing
// else about the board moves between the two frames, so a difference at the
// midpoint is the beam and nothing else — where a bench sample would instead
// measure whatever the build painted between the board and the stage's edge.
//
// WHAT IS NOT DECIDED HERE. specs/board.md pins beam rendering nowhere: the
// hue, the width, the styling and any animation are the build's, and whether
// they look right is the reviewer's presentation rating. This point decides
// only that the build drew something along the line joining the two centers.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  sampleColor,
  segmentMidpoint,
  traceCells,
  type Harness,
} from "../harness";

/**
 * Two channels posed: triangle down the left column (an orthogonal segment
 * T(0,0)-t(0,1)) and square by a diagonal (S(1,0)-s(2,1)), with the diamond
 * present because a board's declared channels each carry two emitters.
 */
const THREE_CHANNEL_BOARD = `
TS.D
t.sd
TS.D
`;

/** The two segments traced, each between its own channel's nodes. */
const ORTHOGONAL = [
  { col: 0, row: 0 },
  { col: 0, row: 1 },
] as const;
const DIAGONAL = [
  { col: 1, row: 0 },
  { col: 2, row: 1 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an orthogonal and a diagonal segment through their midpoints", async () => {
  const board = await loadBoard(h, THREE_CHANNEL_BOARD);
  const orthoMid = segmentMidpoint(board, ORTHOGONAL[0], ORTHOGONAL[1]);
  const diagMid = segmentMidpoint(board, DIAGONAL[0], DIAGONAL[1]);

  // The two midpoints with every beam empty, one advanced frame after the
  // board was posed.
  await h.advance(1);
  const orthoBefore = await sampleColor(h, orthoMid.x, orthoMid.y);
  const diagBefore = await sampleColor(h, diagMid.x, diagMid.y);

  // One orthogonal triangle segment and one diagonal square segment, then the
  // frame that renders them.
  await traceCells(h, [...ORTHOGONAL]);
  await traceCells(h, [...DIAGONAL]);
  await h.advance(1);
  await captureStill(h, "beams");

  const orthoAfter = await sampleColor(h, orthoMid.x, orthoMid.y);
  const diagAfter = await sampleColor(h, diagMid.x, diagMid.y);

  assertGreaterThan(
    colorDistance(orthoAfter, orthoBefore),
    0,
    "the orthogonal segment's midpoint, drawn against the same point with " +
      "the triangle beam empty",
  );
  assertGreaterThan(
    colorDistance(diagAfter, diagBefore),
    0,
    "the diagonal segment's midpoint, drawn against the same point with " +
      "the square beam empty",
  );
});
