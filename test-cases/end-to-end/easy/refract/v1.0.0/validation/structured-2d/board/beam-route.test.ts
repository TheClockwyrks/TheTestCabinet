// Refract — board/beam-route: a drawn beam visibly connects the cells it
// links, and carries its channel's hue.
//
// specs/board.md "Presentation is yours": a drawn beam visibly connects the
// centers of the cells it links, so its route is unambiguous, and it carries
// its channel's hue. Both halves are decided at a segment's midpoint — the one
// point every straight connection of the two centers passes through:
//
//   1. VISIBLE: the midpoint cluster differs from the background sample by
//      more than the item's 50 of 441 RGB distance, for an orthogonal and for
//      a diagonal segment — the two orientations a route is drawn in.
//   2. ITS OWN HUE: each midpoint sits closer in RGB to its own channel's
//      sampled node color than to either other channel's, so the route also
//      says WHOSE it is. The channel colors are sampled at the three lens
//      centers — the filled silhouettes — on the same frame.
//
// The board carries all three channels so both comparisons have all three
// hues to compare against; the two segments are traced on two different
// channels through the build's own pointer path, one orthogonal and one
// diagonal, each between the traced channel's own nodes so no rule refuses
// them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  sampleBackground,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { cellCenter, type Board, type Channel } from "../notation";
import { sampleMidpointAlong } from "./pixels";

/** The item's line for a beam clearly apart from the bench: 50 of 441. */
const APART_MIN = 50;

/**
 * All three channels on a 4x4 board: triangle across the top (its segment
 * T(0,0)-t(1,0) is the ORTHOGONAL one), square from S(0,1) down to its lens
 * s(1,2) (the DIAGONAL one — the only diagonal its 2x2 block holds), and
 * diamond posed but untraced, its lens d(0,3) the third hue's sample.
 */
const THREE_CHANNELS = `
Tt.T
S..D
.s.S
d..D
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

/** The lens centers of the posed board, one per channel. */
function lensCenters(board: Board): Record<Channel, { x: number; y: number }> {
  const centers = {} as Record<Channel, { x: number; y: number }>;
  for (const node of board.nodes) {
    if (node.kind !== "lens" || node.channel === null) continue;
    centers[node.channel] = cellCenter(
      node.col,
      node.row,
      board.cols,
      board.rows,
    );
  }
  return centers;
}

it("draws an orthogonal and a diagonal segment visibly, each in its channel's hue", async () => {
  const board = await loadBoard(h, THREE_CHANNELS);

  // The two segments, through the build's own pointer path.
  h.debug.trace([
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  h.debug.trace([
    { col: 0, row: 1 },
    { col: 1, row: 2 },
  ]);
  const snapshot = h.snapshot();
  assertDeepEqual(
    snapshot.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the orthogonal triangle segment is drawn",
  );
  assertDeepEqual(
    snapshot.beams.square?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 2 },
    ],
    "the diagonal square segment is drawn",
  );

  await h.advance(1);
  // An orthogonal and a diagonal segment drawn.
  captureStill(h, "beams");

  const background = sampleBackground(h);
  const hues = lensCenters(board);
  const channelColors: Record<Channel, Rgb> = {
    triangle: sampleColor(h, hues.triangle.x, hues.triangle.y),
    square: sampleColor(h, hues.square.x, hues.square.y),
    diamond: sampleColor(h, hues.diamond.x, hues.diamond.y),
  };

  const segments = [
    {
      name: "the orthogonal triangle segment",
      channel: "triangle" as const,
      from: cellCenter(0, 0, board.cols, board.rows),
      to: cellCenter(1, 0, board.cols, board.rows),
    },
    {
      name: "the diagonal square segment",
      channel: "square" as const,
      from: cellCenter(0, 1, board.cols, board.rows),
      to: cellCenter(1, 2, board.cols, board.rows),
    },
  ];
  for (const segment of segments) {
    const midpoint = sampleMidpointAlong(h, segment.from, segment.to);
    assertGreaterThan(
      colorDistance(midpoint, background),
      APART_MIN,
      `${segment.name}'s midpoint cluster, clearly apart from the bench`,
    );
    const own = colorDistance(midpoint, channelColors[segment.channel]);
    for (const other of Object.keys(channelColors) as Channel[]) {
      if (other === segment.channel) continue;
      assertLessThan(
        own,
        colorDistance(midpoint, channelColors[other]),
        `${segment.name}'s midpoint sits nearer its own ${segment.channel} ` +
          `hue than ${other}'s`,
      );
    }
  }
});
