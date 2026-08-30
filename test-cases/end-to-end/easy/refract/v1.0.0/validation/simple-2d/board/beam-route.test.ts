// Refract — board/beam-route: a drawn beam visibly connects the cells it
// links.
//
// specs/board.md: a drawn beam visibly connects the centers of the cells it
// links, so its route is unambiguous, and it carries its channel's hue. The
// check draws one orthogonal and one diagonal segment on two different
// channels, and reads each segment's midpoint — the point a beam joining the
// two centers must pass through whichever way it is styled:
//
//   - the midpoint cluster differs from the background sample by more than 50
//     of 441 RGB distance (the beam is there);
//   - it sits closer in RGB to its own channel's hue than to either other
//     channel's (it carries its channel's hue).
//
// The three channel colors are read off the same posed board's lens forms
// before anything is traced, so the references and the beams come from the
// same build and the same frame size.
//
// HOW A CHANNEL'S HUE IS READ. As the median color of that channel's lens
// form, against the board's own ground, and not as the lens's center pixel:
// specs/board.md fixes that each channel carries one distinct hue and fixes
// nothing about where inside a node its hue is shown, so a build that lays an
// iris or a socket over the middle of its filled silhouette would hand all
// three comparisons one ornament color. Nor as the form's loudest pixel, which
// on a dark board is a white specular pip or a white outline rather than the
// hue it sits on; the median is the color the form is mostly made of, and no
// ornament covering a minority of it can move it. The three references are read BEFORE
// anything is traced, so no beam's own pixels color them.
//
// A KNOWN NARROWING, recorded here and deliberately not acted on. "Sits closer
// in RGB to its own channel's color than to either other channel's" is a proxy
// for specs/board.md's "it carries its channel's hue", and it is a narrow one:
// specs/board.md pins beam rendering nowhere, so a build drawing a pale core
// inside a colored halo carries its channel's hue perfectly well while its
// midpoint reads nearest white. No build of this cohort fails on it, so the
// reading stands as written and the requirement is one for the next version of
// this case to state exactly or for the assertion to drop.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleBackground,
  sampleColor,
  traceRoute,
  type Harness,
  type Rgb,
} from "../harness";
import { CHANNELS, NODE_R, parseBoard, type Channel } from "../notation";
import { bodyColor, bodyMask, groundSample } from "./masks";

/** The review item's distance: the beam clearly apart from the background. */
const APART_MIN = 50;

/**
 * A 5x3 board carrying all three channels, each with its two emitters as a
 * board must have (specs/board.md): the traced triangle emitter and lens are
 * orthogonal neighbours on the top row, the traced square emitter S(3,2) and
 * lens s(2,1) are diagonal neighbours in their own 2x2 block, and the
 * diamond lens d(4,0) stands clear as the third hue's reference.
 */
const ROUTE_BOARD = `
Tt..d
..s.D
TS.SD
`;

/** The board's dimensions. */
const COLS = 5;
const ROWS = 3;

/** Where each channel's reference node (a lens) sits. */
const LENS_AT: Readonly<Record<Channel, { col: number; row: number }>> = {
  triangle: { col: 1, row: 0 },
  square: { col: 2, row: 1 },
  diamond: { col: 4, row: 0 },
};

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

it("draws each segment through its midpoint, in its own channel's hue", async () => {
  await resetTo(h, 1);
  await loadBoard(h, ROUTE_BOARD);

  // The three channel hues, read before anything is traced.
  const background = sampleBackground(h);
  const ground = groundSample(h, parseBoard(ROUTE_BOARD));
  const reference = new Map<Channel, Rgb>();
  for (const channel of CHANNELS) {
    const at = LENS_AT[channel];
    const center = nodeCenter(at.col, at.row, COLS, ROWS);
    reference.set(
      channel,
      bodyColor(bodyMask(h, center.x, center.y, NODE_R, ground)),
    );
  }

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

  const segments: readonly {
    name: string;
    channel: Channel;
    route: readonly (readonly [number, number])[];
  }[] = [
    { name: "orthogonal", channel: "triangle", route: ORTHOGONAL },
    { name: "diagonal", channel: "square", route: DIAGONAL },
  ];
  for (const segment of segments) {
    const mid = midpoint(segment.route);
    const sampled = sampleColor(h, mid.x, mid.y);
    assertGreaterThan(
      colorDistance(sampled, background),
      APART_MIN,
      `the ${segment.name} segment's midpoint (specs/board.md: a drawn beam ` +
        "visibly connects the centers of the cells it links)",
    );
    const own = colorDistance(sampled, reference.get(segment.channel) as Rgb);
    for (const other of CHANNELS) {
      if (other === segment.channel) continue;
      assertLessThan(
        own,
        colorDistance(sampled, reference.get(other) as Rgb),
        `the ${segment.name} segment's midpoint against the ${other} ` +
          `channel's hue (specs/board.md: a beam carries its channel's ` +
          "hue)",
      );
    }
  }
});
