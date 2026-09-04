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
//      That gives how far the dirt reaches along each edge, `A` and `B`.
//   2. The dirt is followed again along the diagonal that leaves the corner
//      between those two edges, giving how far it reaches there.
//   3. The straight chord between the two edge points crosses that diagonal at
//      `sqrt(2) * A * B / (A + B)`. That is the reach a corner cut off FLAT
//      would have.
//
// A nub bows AWAY from the corner, so it reaches PAST the flat chord; a scooped
// notch bows toward the corner and falls short of it. The comparison holds at any
// radius, because every one of the three reaches is measured off the build's own
// drawing, and it is a ratio of two of them.
//
// AND NOTHING HERE BOUNDS THE REACH ITSELF. `specs/assets.md` states that a
// carved cell is drawn inset with a lip and rounded corners and that an L-bend
// keeps a convex nub; it states no lip width, so a build with a two-unit lip and
// one with a lip most of a tile wide are both conformant and a bound on `A` or
// `B` would fail one of them on a figure that traces to no statement. The ratio
// is the whole of the requirement, and it already fails a corner with no dirt at
// it: a corner the dirt does not reach along reaches nothing along the diagonal
// either, so the reach is `0` and the scan reports it as a bend with no nub.
//
// A chord read at its midpoint instead is not enough here. The scans cannot sit
// exactly on the tile edges without reading the cells beyond them, and a shallow
// scoop of a wide radius under-reads on an inset scan line by enough to drag the
// midpoint back into the dirt. Rounding the bend the way an exterior corner is
// rounded, which is the wrong curvature this point exists to catch, reads 0.86 of
// the flat chord where the nub reads 1.35, so the ratio separates them and the
// midpoint alone does not.
//
// The two colours the samples are read against — the dirt and the fill — come
// from the same frame: the solid cell that pokes into the bend, and the centre of
// the bend cell itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
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
import { type StagePoint, readsAs, stageOf } from "./sample";

/** How far from the corner a scan starts, so it never reads the corner itself. */
const SCAN_FROM = 1;

/** How far a scan runs before it gives up, in units: most of a tile. */
const SCAN_TO = 40;

/**
 * How far into the open cell an edge scan line sits, off the edge it follows.
 *
 * One unit: the closest a scan can sit to the edge without reading the cell on
 * the other side of it, and therefore the closest estimate of where the dirt's
 * boundary actually meets the edge.
 */
const SCAN_OFF = 1;

/**
 * How far past the flat chord the dirt must reach along the diagonal for the
 * corner to be a bulge rather than a flat cut or a hollow.
 *
 * A tenth: a quarter-disc nub reaches `sqrt(2)` times the chord and a corner cut
 * off straight reaches exactly it, so a tenth asks for a boundary that is
 * plainly bowed outward while leaving room for the units a scan is quantised to.
 */
const BULGE_MIN = 1.1;

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

  // And along the diagonal that leaves the corner between those two edges.
  const alongDiagonal = await dirtReach(
    h,
    { x: corner.x, y: corner.y },
    { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    dirt,
    fill,
  );
  await captureStill(h, "bend");

  // Where the straight chord between the two edge points crosses that diagonal.
  const flatChord =
    (Math.SQRT2 * alongTop * alongRight) / (alongTop + alongRight);

  // The reading only says something where the two ends of it are apart.
  assertGreaterThan(
    colorDistance(dirt, fill),
    DISTINCT_MIN,
    "the band's unmined rock drawn clearly apart from the carved tunnel's fill, in RGB distance",
  );

  // There is dirt at the bend at all. PRESENCE rather than size: a convex nub at
  // the shared corner necessarily leaves dirt along both edges that run out of
  // it, so a reach of zero on either is a bend with no nub — and a zero would
  // also leave the chord below with nothing to be a fraction of.
  assertGreaterThan(
    alongTop,
    0,
    "dirt kept along the bend's top edge, out from the corner the rock pokes into",
  );
  assertGreaterThan(
    alongRight,
    0,
    "dirt kept along the bend's right edge, out from the corner the rock pokes into",
  );

  // And it bulges: along the diagonal the dirt reaches past the flat chord
  // rather than falling short of it.
  assertGreaterThanOrEqual(
    alongDiagonal / flatChord,
    BULGE_MIN,
    "the dirt's reach along the bend's diagonal over the reach a corner cut off flat would have, so the nub bulges into the tunnel rather than being scooped out of it",
  );
});
