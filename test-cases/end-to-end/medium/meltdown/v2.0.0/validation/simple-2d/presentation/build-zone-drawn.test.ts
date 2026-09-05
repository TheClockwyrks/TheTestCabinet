// presentation/build-zone-drawn — a mode that restricts building shows a player
// where it may be done.
//
// THE RULE. specs/overview.md's legibility table: "The build zone — A mode that
// restricts building draws the zone it restricts building to." specs/modes.md
// names the one such mode and fixes the rectangle: "Bottleneck restricts building
// to a marked central zone, `BOTTLENECK_ZONE`: columns `13` through `36` and rows
// `8` through `27`, both ends included." So what the point decides is that the
// FOUR EDGES of that rectangle are visible on the floor, since a player who cannot
// see them finds the zone by being refused.
//
// WHY THE READING IS BOTTLENECK AGAINST A MODE WITH NO ZONE. specs/overview.md
// fixes no palette, and specs/floor.md puts a grid line on every tile boundary —
// which is exactly where the zone's edges fall. A single frame therefore cannot
// tell a marked edge from the grid line under it, and comparing the mark against
// the floor beside it would be comparing two things the build drew.
// specs/modes.md supplies the control: "Every mode plays the same game: the same
// floor ... A mode changes the figures its own row below states, and nothing else
// beyond what its own section names." Containment's row fixes no zone, so the same
// empty floor drawn under Containment and under Bottleneck differs in the zone
// marking and in nothing else on the floor at all. Every reading below is that
// difference.
//
// THE TWO HALVES OF THE READING, AND WHY BOTH.
//
//   1. SOMETHING CHANGED AT THE EDGE. Along each of the four edges, at some point
//      within a tile of it, the picture moves by more than the floor moves on its
//      own. That refuses a build that draws no zone, and a build that draws one
//      somewhere other than where specs/modes.md puts it.
//   2. AND SOMETHING NEARBY DID NOT. Along the same edge, some point within that
//      same tile is untouched. That is what makes the change an EDGE rather than a
//      wash: a build that simply tints the whole floor whenever the mode is
//      Bottleneck has drawn no zone, and it moves every point alike.
//
// AND WHERE THE BAR COMES FROM. Not a stated distance — specs/overview.md hands
// the palette to the build, so how strongly a zone is marked is the reviewer's to
// judge. The same strip is read twice under Containment, which is how far the
// floor moves between two frames under a build that animates it, and the marking
// has to beat that by `NOISE_MARGIN` while the untouched point stays inside it.
//
// WHY THE STRIP REACHES BOTH WAYS, AND WHY THAT MATTERS. The points run from a
// tile outside the edge to a tile inside it. Three ways of drawing a zone are all
// ordinary — filling the ground inside it, dimming the ground outside it, and
// ruling a line along it — and reading only one side would fail two of them. A
// strip that spans the edge passes all three and still refuses a floor-wide wash,
// because whichever side is marked, the other one is not.
//
// WHAT IT DOES NOT DECIDE. That a footprint outside the zone is REFUSED is the
// `building` group's, and which rectangle the zone is is the `modes` group's.
// This is pixels, and it is about whether a player can see the line.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { BOTTLENECK_ZONE, TILE, tileLeft, tileTop } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { NOISE_MARGIN, readPoints, type Point } from "./read";

/**
 * How far either side of an edge, in logical units, the strip is read.
 *
 * Negative is outside the zone and positive inside. The fine depths catch a line
 * ruled along the edge, whatever width a build draws it at; the far ones, more
 * than a tile out and a tile in, are what let a mark be told from a wash — a
 * marking treatment that reached them both would be a tile and a half thick.
 */
const DEPTHS: readonly number[] = [-24, -12, -4, -2, -1, 1, 2, 4, 12, 24];

/** Where along an edge, as fractions of its length, the strip is read. */
const ALONGS: readonly number[] = [
  0.05, 0.14, 0.23, 0.32, 0.41, 0.5, 0.59, 0.68, 0.77, 0.86, 0.95,
];

/** One edge of the zone, in stage units, and how to step off it. */
interface Edge {
  name: string;
  /** The point `depth` units inward from the edge, `along` of the way down it. */
  at(depth: number, along: number): Point;
}

/** The rectangle specs/modes.md fixes, in stage units. */
const X0 = tileLeft(BOTTLENECK_ZONE.col0);
const X1 = tileLeft(BOTTLENECK_ZONE.col1 + 1);
const Y0 = tileTop(BOTTLENECK_ZONE.row0);
const Y1 = tileTop(BOTTLENECK_ZONE.row1 + 1);

const EDGES: readonly Edge[] = [
  {
    name: "the zone's left edge",
    at: (depth, along) => ({ x: X0 + depth, y: Y0 + along * (Y1 - Y0) }),
  },
  {
    name: "the zone's right edge",
    at: (depth, along) => ({ x: X1 - depth, y: Y0 + along * (Y1 - Y0) }),
  },
  {
    name: "the zone's top edge",
    at: (depth, along) => ({ x: X0 + along * (X1 - X0), y: Y0 + depth }),
  },
  {
    name: "the zone's bottom edge",
    at: (depth, along) => ({ x: X0 + along * (X1 - X0), y: Y1 - depth }),
  },
];

/** Every point of every edge's strip, edge by edge. */
const STRIP: Point[] = EDGES.flatMap((edge) =>
  ALONGS.flatMap((along) => DEPTHS.map((depth) => edge.at(depth, along))),
);

const PER_EDGE = ALONGS.length * DEPTHS.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks the zone Bottleneck restricts building to", async () => {
  // The same empty floor under a mode with no zone, twice, so how far the floor
  // moves on its own is measured rather than assumed.
  startRun(h, "containment");
  await h.advance(1);
  const first = readPoints(h, STRIP);
  await h.advance(1);
  const unzoned = readPoints(h, STRIP);

  startRun(h, "bottleneck");
  await h.advance(1);
  captureStill(h, "zone");
  const zoned = readPoints(h, STRIP);

  for (const [index, edge] of EDGES.entries()) {
    let strongest = 0;
    let quietest = Infinity;
    let noise = 0;
    let strongestAt: Point = STRIP[index * PER_EDGE];
    for (let n = 0; n < PER_EDGE; n += 1) {
      const i = index * PER_EDGE + n;
      const moved = colorDistance(unzoned[i], zoned[i]);
      if (moved > strongest) {
        strongest = moved;
        strongestAt = STRIP[i];
      }
      quietest = Math.min(quietest, moved);
      noise = Math.max(noise, colorDistance(first[i], unzoned[i]));
    }

    assertGreaterThanOrEqual(
      strongest,
      noise + NOISE_MARGIN,
      `${edge.name}, columns ${BOTTLENECK_ZONE.col0}-${BOTTLENECK_ZONE.col1} ` +
        `by rows ${BOTTLENECK_ZONE.row0}-${BOTTLENECK_ZONE.row1}: within a ` +
        `tile of it, at (${Math.round(strongestAt.x)}, ` +
        `${Math.round(strongestAt.y)}), Bottleneck draws something ` +
        `Containment does not, past the ${noise} two Containment frames moved ` +
        `on their own (specs/overview.md: a mode that restricts building ` +
        `draws the zone; specs/modes.md fixes the rectangle)`,
    );
    assertLessThanOrEqual(
      quietest,
      noise + NOISE_MARGIN,
      `${edge.name}: some point within a tile of it — ${TILE} units either ` +
        `side — is drawn the same way under both modes, so the marking is an ` +
        `edge a player can place a footprint against rather than a wash over ` +
        `the whole floor (specs/modes.md: every mode plays the same game on ` +
        `the same floor)`,
    );
  }
});
