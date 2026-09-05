// Refract — board/beam-route: a drawn beam visibly connects the cells it
// links.
//
// specs/board.md "Presentation is yours": a drawn beam visibly connects the
// centers of the cells it links, so its route is unambiguous. That is decided
// at a segment's midpoint — the one point every straight connection of the two
// centers passes through — for an orthogonal and for a diagonal segment, the
// two orientations a route is drawn in.
//
// THE COMPARAND IS THE SAME POINT WITH THE BEAM EMPTY. Each midpoint cluster is
// read twice on the same posed board: once with no segment traced and once with
// the segment drawn, both one advanced frame after the state they read. Nothing
// else about the board moves between the two frames, so a difference at the
// midpoint is the beam and nothing else — where a background sample would
// instead measure whatever the build painted between the board and the stage's
// edge.
//
// The board carries all three channels because a board's declared channels each
// carry two emitters; the two segments are traced on two different channels
// through the build's own pointer path, one orthogonal and one diagonal, each
// between the traced channel's own nodes so no rule refuses them.
//
// WHAT IS NOT DECIDED HERE. specs/board.md pins beam rendering nowhere: the
// hue, the width, the styling and any animation are the build's, and whether
// they look right is the reviewer's presentation rating. This point decides
// only that the build drew something along the line joining the two centers.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";
import { cellCenter } from "../notation";
import { sampleMidpointAlong } from "./pixels";

/**
 * All three channels on a 4x4 board: triangle across the top (its segment
 * T(0,0)-t(1,0) is the ORTHOGONAL one), square from S(0,1) down to its lens
 * s(1,2) (the DIAGONAL one — the only diagonal its 2x2 block holds), and
 * diamond posed but untraced.
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

it("draws an orthogonal and a diagonal segment visibly", async () => {
  const board = await loadBoard(h, THREE_CHANNELS);

  const segments = [
    {
      name: "the orthogonal triangle segment",
      from: cellCenter(0, 0, board.cols, board.rows),
      to: cellCenter(1, 0, board.cols, board.rows),
    },
    {
      name: "the diagonal square segment",
      from: cellCenter(0, 1, board.cols, board.rows),
      to: cellCenter(1, 2, board.cols, board.rows),
    },
  ];

  // The two midpoint clusters with every beam empty, one advanced frame after
  // the board was posed.
  await h.advance(1);
  const before = segments.map((segment) =>
    sampleMidpointAlong(h, segment.from, segment.to),
  );

  // The two segments, through the build's own pointer path.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  traceCells(h, [
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

  for (const [index, segment] of segments.entries()) {
    const after = sampleMidpointAlong(h, segment.from, segment.to);
    assertGreaterThan(
      colorDistance(after, before[index]),
      0,
      `${segment.name}'s midpoint cluster, drawn against the same cluster ` +
        "with its beam empty",
    );
  }
});
