// Refract — board/beam-route: a drawn beam visibly connects the cells it
// links.
//
// specs/board.md: a drawn beam visibly connects the centers of the cells it
// links, so its route is unambiguous. The check draws one orthogonal and one
// diagonal segment on two different channels, and reads each segment's midpoint
// — the point a beam joining the two centers must pass through whichever way it
// is styled.
//
// THE COMPARAND IS THE SAME POINT WITH THE BEAM EMPTY. Each midpoint is read
// twice on the same posed board: once with no segment traced and once with the
// segment drawn, both one advanced frame after the state they read. Nothing
// else about the board moves between the two frames, so a difference at the
// midpoint is the beam and nothing else — where a background sample would
// instead measure whatever the build painted between the board and the stage's
// edge.
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
  nodeCenter,
  resetTo,
  sampleColor,
  traceRoute,
  type Harness,
} from "../harness";

/**
 * A 5x3 board carrying all three channels, each with its two emitters as a
 * board must have (specs/board.md): the traced triangle emitter and lens are
 * orthogonal neighbours on the top row, and the traced square emitter S(3,2)
 * and lens s(2,1) are diagonal neighbours in their own 2x2 block.
 */
const ROUTE_BOARD = `
Tt..d
..s.D
TS.SD
`;

/** The board's dimensions. */
const COLS = 5;
const ROWS = 3;

/** The orthogonal segment: triangle T(0,0) -> t(1,0). */
const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
];

/** The diagonal segment: square S(3,2) -> s(2,1), the only diagonal of its
 * 2x2 block (specs/beams.md R4 permits it). */
const DIAGONAL: readonly (readonly [number, number])[] = [
  [3, 2],
  [2, 1],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The midpoint of the segment joining two cell centers. */
function midpoint(route: readonly (readonly [number, number])[]): {
  x: number;
  y: number;
} {
  const [[colA, rowA], [colB, rowB]] = [route[0], route[1]];
  const a = nodeCenter(colA, rowA, COLS, ROWS);
  const b = nodeCenter(colB, rowB, COLS, ROWS);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

it("draws each segment through its midpoint", async () => {
  await resetTo(h, 1);
  await loadBoard(h, ROUTE_BOARD);

  const segments = [
    { name: "orthogonal", route: ORTHOGONAL },
    { name: "diagonal", route: DIAGONAL },
  ].map((segment) => ({ ...segment, at: midpoint(segment.route) }));

  // The two midpoints with every beam empty, one advanced frame after the
  // board was posed.
  await h.advance(1);
  const before = segments.map((segment) =>
    sampleColor(h, segment.at.x, segment.at.y),
  );

  // Draw the two segments; each trace takes effect as it is made.
  traceRoute(h, ORTHOGONAL);
  traceRoute(h, DIAGONAL);
  const beams = h.snapshot().beams;
  assertDeepEqual(
    beams.triangle?.cells,
    ORTHOGONAL.map(([col, row]) => ({ col, row })),
    "the orthogonal triangle segment is drawn (specs/beams.md R1)",
  );
  assertDeepEqual(
    beams.square?.cells,
    DIAGONAL.map(([col, row]) => ({ col, row })),
    "the diagonal square segment is drawn (specs/beams.md R1, R4)",
  );

  await h.advance(1);
  captureStill(h, "beams");

  for (const [index, segment] of segments.entries()) {
    const after = sampleColor(h, segment.at.x, segment.at.y);
    assertGreaterThan(
      colorDistance(after, before[index]),
      0,
      `the ${segment.name} segment's midpoint, drawn against the same point ` +
        "with its beam empty (specs/board.md: a drawn beam visibly connects " +
        "the centers of the cells it links)",
    );
  }
});
