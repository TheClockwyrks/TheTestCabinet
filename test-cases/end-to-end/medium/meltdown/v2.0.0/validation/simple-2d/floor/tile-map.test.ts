// floor/tile-map — a tile is where the map puts it, on the floor and in the
// snapshot.
//
// THE RULE. specs/floor.md owns the tile-to-stage map and states it as
// arithmetic: `tileLeft(c) = FLOOR_X0 + TILE * c`, `tileTop(r) = FLOOR_Y0 + TILE * r`,
// so "Tile `(c, r)` therefore spans `x` in `[18 + 19c, 18 + 19c + 19]` and `y` in
// `[18 + 19r, 18 + 19r + 19]`". A tower "occupies a square footprint of
// `size x size` tiles, snapped to the grid and anchored by its top-left tile
// `(col, row)`". And the inverse, "which is how the tile an entity occupies is
// read from its centre", is `c = floor((x - FLOOR_X0) / TILE)`.
//
// This file decides both directions of that one map, one to a check.
//
//   1. FORWARD. Eight towers spread over the floor each report the anchor they
//      were built on, and each is DRAWN over the stage rectangle the map gives
//      that anchor, within the half tile the item allows.
//   2. INVERSE. A unit's centre placed inside a tile is reported as being on that
//      tile — including at nine tenths of the way across it and at one tenth,
//      where a build that rounded to the nearest tile boundary instead of taking
//      the floor of the division reports the neighbour.
//
// HOW "DRAWN OVER THAT RECTANGLE" IS READ, AND WHY IT IS A DIFFERENCE. The look
// is the build's: specs/overview.md fixes no palette, and a tower may be a plate,
// a turret, a disc or a cluster of parts, over a floor that may carry a texture,
// lane markings or a wash. So nothing here asks what colour anything is. The
// floor is rendered TWICE with nothing built, which measures how much the build's
// own art moves between two frames, and then a third time with the eight towers
// standing. A pixel counts as part of a tower where the third frame differs from
// the second by more than both a fixed floor and that measured movement — so a
// build whose floor animates raises its own bar rather than passing on the
// strength of the animation.
//
// WHAT IS ASSERTED ABOUT THE EXTENT SO FOUND. Three things, and each of them is
// the item's half tile:
//
//   - It REACHES both edges: the body is drawn from within half a tile of one
//     edge of the footprint to within half a tile of the other.
//   - It is CENTRED on the footprint: the midpoint of what was drawn sits within
//     half a tile of the rectangle's own centre. This is what catches a map with
//     the wrong pitch or the wrong origin, because a footprint drawn a whole tile
//     off is drawn a whole tile off.
//   - It does not RUN AWAY: nothing counted as this tower is more than a tile and
//     a half beyond the rectangle. Half a tile is the item's tolerance and the
//     further tile is for a halo, a shadow or a rim a build may draw around its
//     body; a build reaching past that is not covering that rectangle.
//
// WHY EIGHT ANCHORS, AND THESE EIGHT. Four in the floor's four corners, where a
// missing `FLOOR_X0` offset or an inverted axis is largest, and four spread
// through the middle, where a wrong PITCH has had room to accumulate. Each is far
// enough from the next that a scan across one reaches no other.

import { afterEach, beforeEach, it } from "vitest";
import {
  STAGE_H,
  STAGE_W,
  TILE,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { sizeOf, type Point, type Tile } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  towerOf,
  unitOf,
  type Harness,
} from "../harness";
import { pixelsAt } from "./read";

/** The item's own tolerance: half a tile, in logical units. */
const HALF_TILE = TILE / 2;

/**
 * How far past the footprint anything counted as the tower may reach, in logical
 * units: the item's half tile, and a further tile for a halo or a shadow.
 */
const OVERREACH_MAX = TILE * 1.5;

/**
 * How far a pixel must move, out of the 441 the RGB cube spans, before it counts
 * as part of the tower rather than as the floor it was drawn over.
 *
 * The bar has to sit BELOW the quietest thing a build may legitimately draw at
 * the edge of a footprint, because this reading is about where the body's edges
 * are: a build is free to trim its towers with a dark rim, a plain-face bar or a
 * bevel, and every one of those moves an edge pixel only a little even though the
 * body's own middle moves it a long way. So 8 is the same figure
 * `floor/grid-visible` uses for a visible step: under two per cent of the scale,
 * enough that nothing a build actually drew is missed, and enough above zero that
 * a floor nothing was drawn on reads as untouched.
 */
const DRAWN_MIN = 8;

/**
 * How far above the floor's own frame-to-frame movement a pixel must move, on top
 * of {@link DRAWN_MIN}, to count.
 *
 * A build whose floor is animated moves pixels on its own, and a check that read
 * that movement as a tower would find a tower everywhere. The same figure as
 * `DRAWN_MIN`, so a floor that moves by X needs the tower to move by X + 8.
 */
const NOISE_MARGIN = DRAWN_MIN;

/**
 * How far beyond each edge of the footprint a scan runs, in tiles.
 *
 * Two tiles of clear floor on each side, so a body drawn a whole tile off its
 * anchor is still found and reported as displaced rather than as absent. A scan
 * that would run off the stage is clipped to it — the corner anchors sit one tile
 * in from the floor's own edge, so what is clipped away is casing rather than
 * floor a tower could have been drawn on.
 */
const SCAN_MARGIN_TILES = 2;

/** The eight anchors: the floor's four corners and four spread through it. */
const ANCHORS: readonly Tile[] = [
  { col: 1, row: 1 },
  { col: 46, row: 1 },
  { col: 1, row: 32 },
  { col: 46, row: 32 },
  { col: 12, row: 8 },
  { col: 35, row: 8 },
  { col: 12, row: 26 },
  { col: 35, row: 26 },
];

/** The type every anchor carries: the roster's 2x2 (specs/towers.md). */
const TYPE = "arc";
const SIZE = sizeOf(TYPE);

/** One scan: a run of points at one unit's spacing, and the axis it measures. */
interface Scan {
  axis: "x" | "y";
  from: number;
  points: Point[];
}

/**
 * The four scans that measure one anchor's drawn extent: two across it and two
 * down it, each at a third and two thirds of the footprint so a body with a hole
 * in its middle is still found.
 */
function scansFor(anchor: Tile): Scan[] {
  const left = tileLeft(anchor.col);
  const top = tileTop(anchor.row);
  const span = SIZE * TILE;
  const margin = SCAN_MARGIN_TILES * TILE;
  const offsets = [span / 3, (span * 2) / 3];

  const scans: Scan[] = [];
  for (const offset of offsets) {
    const fromX = Math.max(0, left - margin);
    const toX = Math.min(STAGE_W - 1, left + span + margin);
    const acrossPoints: Point[] = [];
    for (let x = fromX; x <= toX; x += 1) {
      acrossPoints.push({ x, y: top + offset });
    }
    scans.push({ axis: "x", from: fromX, points: acrossPoints });

    const fromY = Math.max(0, top - margin);
    const toY = Math.min(STAGE_H - 1, top + span + margin);
    const downPoints: Point[] = [];
    for (let y = fromY; y <= toY; y += 1) {
      downPoints.push({ x: left + offset, y });
    }
    scans.push({ axis: "y", from: fromY, points: downPoints });
  }
  return scans;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each of eight towers over the rectangle its anchor maps to", async () => {
  startRun(h);

  // Every point every scan reads, flattened once so the three renders below are
  // read the same way and in the same order.
  const scans = ANCHORS.flatMap((anchor) => scansFor(anchor));
  const points = scans.flatMap((scan) => scan.points);

  await h.advance(1);
  const before = pixelsAt(h, points);
  await h.advance(1);
  const again = pixelsAt(h, points);

  const built = ANCHORS.map((anchor) =>
    poseTower(h, TYPE, anchor.col, anchor.row),
  );
  await h.advance(1);
  captureStill(h, "tiles");
  const standing = pixelsAt(h, points);

  const posed = h.snapshot();
  assertEqual(
    posed.towers.length,
    ANCHORS.length,
    "the eight towers on the floor",
  );

  let cursor = 0;
  for (const [index, anchor] of ANCHORS.entries()) {
    const tower = towerOf(posed, built[index]);

    // What the build says it built, against the anchor it was asked for.
    const at = `the ${TYPE} anchored at (${anchor.col}, ${anchor.row})`;
    assertEqual(tower.col, anchor.col, `${at}: the footprint's column`);
    assertEqual(tower.row, anchor.row, `${at}: the footprint's row`);
    assertEqual(tower.size, SIZE, `${at}: the footprint's size in tiles`);

    // And what it drew, along the four scans this anchor owns.
    const extents = new Map<"x" | "y", { min: number; max: number }>();
    for (let n = 0; n < 4; n += 1) {
      const scan = scans[index * 4 + n];
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let step = 0; step < scan.points.length; step += 1) {
        const i = cursor + step;
        const noise = colorDistance(before[i], again[i]);
        const moved = colorDistance(again[i], standing[i]);
        if (moved >= DRAWN_MIN && moved >= noise + NOISE_MARGIN) {
          min = Math.min(min, scan.from + step);
          max = Math.max(max, scan.from + step);
        }
      }
      cursor += scan.points.length;
      const held = extents.get(scan.axis);
      extents.set(scan.axis, {
        min: Math.min(held?.min ?? Number.POSITIVE_INFINITY, min),
        max: Math.max(held?.max ?? Number.NEGATIVE_INFINITY, max),
      });
    }

    const rectangle = {
      x: {
        low: tileLeft(anchor.col),
        high: tileLeft(anchor.col) + SIZE * TILE,
      },
      y: { low: tileTop(anchor.row), high: tileTop(anchor.row) + SIZE * TILE },
    };

    for (const axis of ["x", "y"] as const) {
      const found = extents.get(axis) as { min: number; max: number };
      const edge = rectangle[axis];
      const label =
        `${at}: what was drawn along ${axis}, against the rectangle ` +
        `[${edge.low}, ${edge.high}] specs/floor.md maps that anchor to`;

      assertTrue(
        Number.isFinite(found.min),
        `${label} — nothing was drawn anywhere within ` +
          `${SCAN_MARGIN_TILES} tiles of it`,
      );

      // It reaches both edges, within the half tile the item allows.
      assertLessThanOrEqual(
        found.min,
        edge.low + HALF_TILE,
        `${label} — starts`,
      );
      assertGreaterThanOrEqual(
        found.max,
        edge.high - HALF_TILE,
        `${label} — ends`,
      );
      // It is centred on the rectangle, which is what a wrong pitch or a wrong
      // origin moves.
      assertLessThanOrEqual(
        Math.abs((found.min + found.max) / 2 - (edge.low + edge.high) / 2),
        HALF_TILE,
        `${label} — is centred on`,
      );
      // And nothing counted as this tower runs away from it.
      assertGreaterThanOrEqual(
        found.min,
        edge.low - OVERREACH_MAX,
        `${label} — does not start before`,
      );
      assertLessThanOrEqual(
        found.max,
        edge.high + OVERREACH_MAX,
        `${label} — does not end after`,
      );
    }
  }
});

it("reads the tile a centre falls in by the floor of the division", () => {
  startRun(h);
  const id = poseTarget(h, "mote", ANCHORS[0].col, ANCHORS[0].row);

  // Nine tenths of the way across a tile and one tenth into it: both inside the
  // tile, and both on the far side of the boundary a build that rounded, or took
  // a ceiling, would put them on.
  const fractions: readonly { name: string; of: number }[] = [
    { name: "at its centre", of: 0.5 },
    { name: "nine tenths of the way across it", of: 0.9 },
    { name: "one tenth of the way into it", of: 0.1 },
  ];

  for (const anchor of ANCHORS) {
    for (const fraction of fractions) {
      const x = tileLeft(anchor.col) + TILE * fraction.of;
      const y = tileTop(anchor.row) + TILE * fraction.of;
      h.debug.setUnitPosition(id, x, y);

      const unit = unitOf(h.snapshot(), id);
      const at =
        `a centre at (${x}, ${y}), ${fraction.name} inside tile ` +
        `(${anchor.col}, ${anchor.row})`;
      assertEqual(unit.col, anchor.col, `${at}: the column reported`);
      assertEqual(unit.row, anchor.row, `${at}: the row reported`);
    }
  }

  // And the forward map agrees with it: the tile's own centre reads as that tile.
  for (const anchor of ANCHORS) {
    h.debug.setUnitPosition(id, tileCX(anchor.col), tileCY(anchor.row));
    const unit = unitOf(h.snapshot(), id);
    assertEqual(
      `${unit.col},${unit.row}`,
      `${anchor.col},${anchor.row}`,
      `the tile whose centre is (${tileCX(anchor.col)}, ${tileCY(anchor.row)})`,
    );
  }
});
