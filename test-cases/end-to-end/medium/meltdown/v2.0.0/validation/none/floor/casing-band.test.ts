// floor/casing-band — the casing is an 18-unit band on all four sides, and the
// floor begins where the specification says it does.
//
// THE RULE. `specs/floor.md`: "The floor is ringed by a solid casing band
// `CASING` (`18`) units thick on all four sides. Its outer edge is the reactor
// region's boundary and its inner edge is the floor's, so the band spans `x` in
// `[0, 18]` and `[968, 986]` and `y` in `[0, 18]` and `[702, 720]` ... It is
// drawn unbroken except at those four openings." What a check reads off the
// canvas is the geometry: the inner face of the band is where the specification
// puts it, on all four walls.
//
// HOW A BAND IS TOLD FROM A FLOOR WITHOUT READING A COLOUR. `specs/overview.md`
// hands the palette to the build — "The palette, the type, the glow, and every
// other aspect of the look are yours" — so how far a casing sits from a floor is
// the reviewer's to judge and no figure any check may invent. What separates the
// two is what can stand on them: `specs/floor.md` makes the casing "impassable
// and not buildable", so a tower can stand on the first rank of FLOOR and can
// never stand on the band. So a tower is posed against each wall and the picture
// is read before and after: a point on the floor side of the boundary changes,
// and a point on the band side does not.
//
// WHERE THE BOUNDARY IS BRACKETED. Three depths, measured from the wall's outer
// face inward. At 21 the picture must have MOVED — floor the tower is standing
// on — and at 9 and at 14 it must have moved STRICTLY LESS than that, by a step
// a player can see. A body standing over a depth moves it as much as it moves
// the floor beside it, so the two inside depths together place the body's edge
// past 14 units in and the past depth places it before 21: the 18 the
// specification fixes with about three units either side, enough for the rim a
// build may draw on the inner face and for the antialiasing of it, and nowhere
// near enough to admit a band that swallows the first rank of tiles or a tile
// grid that begins inside the band.
//
// WHY "LESS", NOT "UNMOVED". specs/overview.md hands "the glow, and every other
// aspect of the look" to the build, and a glow, a shadow or a halo around a
// tower's body falls off across the band beside it without the band ceasing to
// be band. Reading the inside depths as untouched would grade that look, which
// no sentence of specs/floor.md fixes; reading them as moved LESS than the floor
// the tower stands on still catches the one thing that sentence does fix, a
// footprint drawn over the band, because a body moves both alike.
//
// HOW MUCH MOVEMENT COUNTS. Measured rather than assumed. Every point is read on
// two frames with the floor empty first, which is how far the picture moves on
// its own under a build that animates it, and the tower has to beat that by
// `NOISE_MARGIN` on the floor side, and fall short of the floor side's movement
// by the same `NOISE_MARGIN` on the band side.
//
// WHY THE READINGS ARE SINGLE PIXELS. The harness's `sampleColor` averages a
// cluster four units wide, which would blur an eighteen-unit band's inner face
// into the floor beside it. `read.ts` says the rest.
//
// WHAT IT DOES NOT DECIDE. That the band is impassable and that nothing can be
// built on it are `floor/casing-impassable` and `floor/casing-not-buildable`,
// which read those as state rather than as pixels. How the openings are drawn is
// `presentation/vents-and-exhausts-read-apart`, and how the casing looks — how
// far it sits from the floor, what it is made of — is the reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  CASING,
  COLS,
  PANEL_X,
  ROWS,
  STAGE_H,
  tileCX,
  tileCY,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { readPixels, type Point } from "./read";

/**
 * How far above the movement two unchanged frames show a reading must sit for
 * the tower to count as having changed the picture, out of the 441 the RGB cube
 * spans.
 *
 * NOT A LEGIBILITY BAR. `specs/overview.md` gives the palette to the build, so no
 * figure here says how far a casing must read from a floor. This is the tolerance
 * on the noise measurement itself: two frames of an animated build do not move by
 * exactly the same amount every pair, so a reading has to clear the measured
 * movement by a little rather than by nothing. Eight units is under two per cent
 * of the scale — far below anything a player would call a difference, and far
 * above the rounding a repeated read of an unchanged frame shows.
 */
const NOISE_MARGIN = 8;

/**
 * The two depths inside the band, and the one just past it, in logical units.
 *
 * The inside pair is read against the past depth at the same rank rather than
 * against a figure of its own, so what the pair decides is where the body's
 * edge is and not how far a build's glow reaches.
 */
const INSIDE_DEPTHS: readonly number[] = [CASING / 2, CASING - 4];
const PAST_DEPTH = CASING + 3;

/**
 * The type posed against each wall.
 *
 * The Arc, whose `2 x 2` footprint (`specs/towers.md`) is the smallest in the
 * roster, so a tower on the first rank of floor reaches no further into the field
 * than it has to and no two of the twenty-four posed here can meet.
 */
const TYPE = "arc";
const SIZE = 2;

/** Where along each wall the boundary is bracketed, clear of the openings. */
const WALL_ROWS: readonly number[] = [2, 7, 12, 23, 28, 33];
const WALL_COLS: readonly number[] = [3, 9, 15, 34, 40, 46];

/**
 * One of the four walls: how to address a depth into it, and where the tower
 * that brackets its inner face stands.
 *
 * A depth is measured from the wall's OUTER face — the reactor region's boundary
 * (`specs/floor.md`) — inward, so the same three depths read the same way on all
 * four sides. The tower is anchored on the first rank of floor beside the wall,
 * so `PAST_DEPTH` falls inside its footprint and the two inside depths do not.
 */
interface Wall {
  name: string;
  /** The ranks along the wall the boundary is bracketed at. */
  ranks: readonly number[];
  /** The point `depth` units into the wall, at rank `n`. */
  at(depth: number, n: number): Point;
  /** The tile the bracketing tower is anchored at, for rank `n`. */
  stand(n: number): { col: number; row: number };
}

const WALLS: readonly Wall[] = [
  {
    name: "the left wall",
    ranks: WALL_ROWS,
    at: (depth, row) => ({ x: depth, y: tileCY(row) }),
    stand: (row) => ({ col: 0, row }),
  },
  {
    name: "the right wall",
    ranks: WALL_ROWS,
    at: (depth, row) => ({ x: PANEL_X - depth, y: tileCY(row) }),
    stand: (row) => ({ col: COLS - SIZE, row }),
  },
  {
    name: "the top wall",
    ranks: WALL_COLS,
    at: (depth, col) => ({ x: tileCX(col), y: depth }),
    stand: (col) => ({ col, row: 0 }),
  },
  {
    name: "the bottom wall",
    ranks: WALL_COLS,
    at: (depth, col) => ({ x: tileCX(col), y: STAGE_H - depth }),
    stand: (col) => ({ col, row: ROWS - SIZE }),
  },
];

/** Every point read, wall by wall and rank by rank: the two depths, then past. */
const POINTS: Point[] = WALLS.flatMap((wall) =>
  wall.ranks.flatMap((rank) => [
    ...INSIDE_DEPTHS.map((depth) => wall.at(depth, rank)),
    wall.at(PAST_DEPTH, rank),
  ]),
);

const STRIDE = INSIDE_DEPTHS.length + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the floor's edge eighteen units in on all four sides", async () => {
  await startRun(h);
  await h.advance(1);
  const first = await readPixels(h, POINTS);
  await h.advance(1);
  await captureStill(h, "casing");
  const empty = await readPixels(h, POINTS);

  for (const wall of WALLS) {
    for (const rank of wall.ranks) {
      const { col, row } = wall.stand(rank);
      await poseTower(h, TYPE, col, row);
    }
  }
  await h.advance(1);
  const standing = await readPixels(h, POINTS);

  let at = 0;
  for (const wall of WALLS) {
    for (const rank of wall.ranks) {
      const base = at;
      at += STRIDE;
      const noise = (i: number) => colorDistance(first[i], empty[i]);
      const moved = (i: number) => colorDistance(empty[i], standing[i]);
      const stand = wall.stand(rank);
      const past = base + INSIDE_DEPTHS.length;

      assertGreaterThan(
        moved(past),
        noise(past) + NOISE_MARGIN,
        `${wall.name} at rank ${rank}, ${PAST_DEPTH} units in: the picture ` +
          `changes when a ${TYPE} stands on tile (${stand.col}, ` +
          `${stand.row}), so this is floor a tower can stand on rather than ` +
          `band, and the wall is no thicker than ${PAST_DEPTH} units ` +
          `(specs/floor.md: ${CASING})`,
      );

      for (const [depthIndex, depth] of INSIDE_DEPTHS.entries()) {
        const i = base + depthIndex;
        assertLessThanOrEqual(
          moved(i),
          moved(past) - NOISE_MARGIN,
          `${wall.name} at rank ${rank}, ${depth} units in: moved less by a ` +
            `${TYPE} standing on tile (${stand.col}, ${stand.row}), the first ` +
            `rank of floor beside it, than the floor ${PAST_DEPTH} units in ` +
            `that its body stands on (moved ${moved(past)}), so the body's ` +
            `edge lies past ${depth} units and the band is still band there ` +
            `(specs/floor.md: the casing is ${CASING} units thick, impassable ` +
            `and not buildable)`,
        );
      }
    }
  }
});
