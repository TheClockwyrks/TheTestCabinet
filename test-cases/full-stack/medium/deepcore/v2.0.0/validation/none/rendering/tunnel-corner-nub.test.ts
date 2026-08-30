// rendering/tunnel-corner-nub — at an L-bend the dirt bulges into the tunnel
// rather than being scooped out of it.
//
// specs/assets.md: "An exterior corner rounds convex; at an L-bend or a
// T-junction, where solid rock pokes diagonally into the bend, the dirt keeps a
// convex nub bulging into the tunnel rather than a scooped-out notch." The bend
// is the one corner where the two treatments differ: rounding it the way an
// exterior corner is rounded takes a bite OUT of the dirt where the rock pokes
// in, and the passage turns around a hollow instead of around a bump.
//
// THE SCENE. Three cells opened in an L inside a solid field — one above the
// bend, the bend itself, and one beside it — with the fourth cell of that two by
// two left solid. That fourth cell is the rock poking diagonally into the bend,
// and the corner the four cells share is where the nub belongs.
//
// THE READING, AND WHY IT IS SHAPE RATHER THAN SIZE. The specification fixes no
// lip width and no corner radius, so nothing here may assume one. What separates
// a bulge from a hollow is CURVATURE, which is read as a chord test the build
// calibrates itself:
//
//   1. From the shared corner, the dirt is followed along each of the two edges
//      that run into the open passage, until it gives way to the tunnel fill.
//      That gives the two points where the dirt's boundary meets those edges.
//   2. The midpoint of the chord between those two points is sampled.
//
// A nub is a boundary that bows AWAY from the corner, so the chord's midpoint is
// inside the dirt. A scooped notch is a boundary that bows TOWARD the corner, so
// the chord's midpoint is out in the fill. The reading holds at any radius,
// because both ends of the chord are measured from the build's own drawing.
//
// The two colours the samples are read against — the dirt and the fill — come
// from the same frame: the solid cell that pokes into the bend, and the centre of
// the bend cell itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertBetween } from "../assert";
import { TILE } from "../constants";
import {
  DISTINCT_MIN,
  captureStill,
  colorDistance,
  createHarness,
  sampleCell,
  type Harness,
  type Rgb,
} from "../harness";
import { layRockField } from "./field";
import { type StagePoint, meanAt, readsAs, stageOf } from "./sample";

/** How far from the corner a scan starts, so it never reads the corner itself. */
const SCAN_FROM = 1;

/** How far a scan runs before it gives up, in units: most of a tile. */
const SCAN_TO = 40;

/** How far into the open cell a scan line sits, off the edge it follows. */
const SCAN_OFF = 2;

/** The least dirt an L-bend must keep along each edge for a nub to be there. */
const NUB_MIN = 3;

/** The most dirt a corner feature may run to before it is a wall, not a nub. */
const NUB_MAX = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How far the dirt runs from `from`, one unit at a time, before the fill starts. */
async function dirtReach(
  h: Harness,
  from: StagePoint,
  step: { x: number; y: number },
  dirt: Rgb,
  fill: Rgb,
): Promise<number> {
  const points: StagePoint[] = [];
  for (let d = SCAN_FROM; d <= SCAN_TO; d += 1) {
    points.push({ x: from.x + step.x * d, y: from.y + step.y * d });
  }
  const read = await h.pixels(points);
  for (const [index, [r, g, b]] of read.entries()) {
    if (readsAs({ r, g, b }, dirt, fill) === "fill")
      return SCAN_FROM + index - 1;
  }
  return SCAN_TO;
}

it("keeps a convex nub of dirt at the inside of an L-bend", async () => {
  const field = await layRockField(h);
  const { row } = field;

  // The L: the cell above the bend, the bend, and the cell beside it. The fourth
  // cell of the two by two is left solid, and is the rock poking into the bend.
  const col = field.fromCol + 2;
  await h.debug.setTile(col, row, "tunnel");
  await h.debug.setTile(col, row + 1, "tunnel");
  await h.debug.setTile(col + 1, row + 1, "tunnel");

  await h.advance(1);
  const snapshot = await h.snapshot();
  const dirt = await sampleCell(h, snapshot, col + 1, row);
  const fill = await sampleCell(h, snapshot, col, row + 1);

  // The corner the four cells share, and the two edges of the bend cell that run
  // into the open passage from it: one back along the top edge, one down the
  // right edge.
  const corner = stageOf(snapshot, (col + 1) * TILE, (row + 1) * TILE);
  const alongTop = await dirtReach(
    h,
    { x: corner.x, y: corner.y + SCAN_OFF },
    { x: -1, y: 0 },
    dirt,
    fill,
  );
  const alongRight = await dirtReach(
    h,
    { x: corner.x - SCAN_OFF, y: corner.y },
    { x: 0, y: 1 },
    dirt,
    fill,
  );

  // The midpoint of the chord between the two boundary points the scans found.
  const chordMid = {
    x: corner.x - alongTop / 2,
    y: corner.y + alongRight / 2,
  };
  const middle = await meanAt(h, [
    chordMid,
    { x: chordMid.x - 1, y: chordMid.y },
    { x: chordMid.x + 1, y: chordMid.y },
    { x: chordMid.x, y: chordMid.y - 1 },
    { x: chordMid.x, y: chordMid.y + 1 },
  ]);
  await captureStill(h, "bend");

  // The reading only says something where the two ends of it are apart.
  assertGreaterThan(
    colorDistance(dirt, fill),
    DISTINCT_MIN,
    "the band's unmined rock drawn clearly apart from the carved tunnel's fill, in RGB distance",
  );

  // There is dirt at the bend at all, and it is a corner feature rather than a
  // wall of dirt across the passage.
  assertBetween(
    alongTop,
    NUB_MIN,
    NUB_MAX,
    "dirt kept along the bend's top edge, out from the corner the rock pokes into",
  );
  assertBetween(
    alongRight,
    NUB_MIN,
    NUB_MAX,
    "dirt kept along the bend's right edge, out from the corner the rock pokes into",
  );

  // And it bulges: the chord between the two boundary points falls inside it.
  assertEqual(
    readsAs(middle, dirt, fill),
    "dirt",
    "the midpoint of the chord across the bend's dirt carrying dirt, so the nub bulges into the tunnel rather than being scooped out of it",
  );
});
