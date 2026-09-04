// Meltdown — presentation/range-ring-on-the-preview — the held preview draws a ring at
// the held type's range, centred on its footprint.
//
// THE RULE. specs/building.md: a held preview carries "a range ring at the held
// type's range, centred on the footprint's centre". specs/overview.md's
// legibility table asks for it too. specs/towers.md gives the range as a radius
// in tiles and specs/floor.md gives the tile size and the footprint's centre, so
// where the ring must be is arithmetic rather than taste.
//
// ONE SURFACE, BECAUSE THE PREVIEW AND THE SELECTION ARE TWO DRAWINGS. A build
// commonly draws one and not the other — the preview is drawn while a placement
// is armed and the selection while the inspector is open — so a build that draws
// the preview's ring and no selection ring must not grade as one that draws
// neither. The selection's ring is `presentation.range-ring-on-a-selection`'s.
//
// WHAT IS READ, AND WHY IT IS READ AT TWO RADII. A ring that is merely SOMEWHERE
// is not the requirement — a build that draws every ring at a fixed radius, or
// that reads the range in units where the specification states tiles, has drawn a
// ring that lies to the player. So the reading is taken twice: at the range,
// where a mark must be found nearly all the way round, and a quarter further out,
// where nearly none may be. A quarter of the range is far wider than any line a
// build draws its ring with, so the two readings cannot both be answered by one
// ring, and a ring at the wrong radius answers neither the way a right one does.
//
// TWO CHECKS, NOT ONE. The held preview and the selected tower are separate
// requirements in specs/building.md, so a build that draws one ring and not the
// other grades differently from one that draws neither.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette, so the ring is whatever the build chose. Each reading asks only
// whether the floor at that point still looks like the floor: the reference is
// what the floor around the tower mostly reads as, taken from the centres of the
// tiles about it, so a build that shades or textures its floor is compared
// against its own floor. The bar is set well above what a tile grid line reads,
// so the grid — which specs/overview.md requires to be visible at all times —
// cannot be mistaken for a ring.
//
// AN ARC, AND WHY IT STANDS WHERE IT DOES. Its `6.0` tiles put the whole ring,
// and the quarter-wider circle the check reads as well, comfortably inside the
// floor from the tile chosen, so no part of either reading falls on the casing or
// on the build panel.
//
// WHAT IT DOES NOT DECIDE. What a tower can actually hit at that range is
// `combat.range`; that arming holds a preview and that pressing a tower selects
// it are `building`'s; that a valid footprint reads apart from a refused one is
// `valid-and-invalid-previews-read-apart`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  TILE,
  TOWER_DEFS,
  emitterStats,
  inBounds,
  tileCX,
  tileCY,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  footprintCenter,
  startRun,
  type Harness,
  type Point,
  type Rgb,
  type TowerType,
} from "../harness";
import { dominant, pixelAt, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a point on the ring must sit from
 * the floor for the ring to have been drawn there.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. It is also what
 * keeps the grid out of the reading: `floor.grid-visible` counts a grid line at
 * eight of 441 above the floor, deliberately quiet so it does not compete with
 * what stands on it, and a ring drawn that quietly is not a ring a player
 * follows.
 */
const APART_MIN = 50;

/**
 * How much of the circle at the range must carry the ring, and how much of the
 * circle a quarter further out may.
 *
 * A ring is a closed curve, so nearly every direction from the centre crosses it;
 * the tenth this leaves is for a build that dashes its ring or opens it where a
 * label sits. The same tenth is the ceiling further out, where a ring at the
 * range puts nothing at all.
 */
const ON_RING_MIN = 0.9;
const OFF_RING_MAX = 0.1;

/**
 * How far outside the range the second reading is taken, as a multiple of it.
 *
 * A quarter of the range is 28 units at the range read here — far more than the
 * width of any line, and far more than the few units of anti-aliasing around one,
 * so a ring drawn at the range cannot reach it.
 */
const OFF_RING_SCALE = 1.25;

/** How many directions from the centre each circle is read along. */
const ANGLES = 24;

/**
 * How far either side of a radius the reading looks, in units.
 *
 * A ring is a line with a width and the specification fixes neither, so a point
 * exactly at the radius may fall just inside or just outside the stroke the build
 * laid down. Three units either way is wider than any ordinary line weight and
 * far narrower than the quarter-range gap between the two circles read.
 */
const RADIAL_WINDOW = 3;

/**
 * How close two tile centres must be to count as the same reading, when the check
 * asks what the floor around the tower mostly is.
 *
 * Half of `APART_MIN`, and the group's figure for two readings that are the same
 * thing rather than two things: a plate texture, lane shading, a vignette.
 */
const SAME_READING_MAX = 25;

/** How far around the tower the floor reference is gathered, in tiles. */
const FLOOR_SPREAD = 10;

/** The tower the ring is read on, and the tile it is anchored at. */
const TYPE: TowerType = "arc";
const COL = 24;
const ROW = 17;

/** The centre the ring is drawn from, and the range it is drawn at. */
const CENTRE: Point = footprintCenter(TYPE, COL, ROW);
const DEF = TOWER_DEFS[TYPE];
if (DEF.kind !== "emitter") {
  // A fault in this check rather than a verdict about the build: only an emitter
  // has a range for a ring to be drawn at (specs/towers.md).
  throw new Error(
    `meltdown presentation/range-ring-drawn.test.ts: ${TYPE} is not an emitter`,
  );
}
/** Level I, which is what a held preview and a freshly placed tower carry. */
const RANGE = emitterStats(DEF, 1).range;
const RADIUS = RANGE * TILE;

/** What the floor around the tower reads as, from the centres of its tiles. */
function floorReading(h: Harness): Rgb {
  const samples: Rgb[] = [];
  for (let c = COL - FLOOR_SPREAD; c <= COL + FLOOR_SPREAD; c += 1) {
    for (let r = ROW - FLOOR_SPREAD; r <= ROW + FLOOR_SPREAD; r += 1) {
      if (!inBounds(c, r)) continue;
      samples.push(pixelAt(h, tileCX(c), tileCY(r)));
    }
  }
  return dominant(samples, SAME_READING_MAX);
}

/** What proportion of the circle at `radius` carries a mark on the floor. */
function ringFraction(h: Harness, radius: number, floor: Rgb): number {
  let marked = 0;
  for (let i = 0; i < ANGLES; i += 1) {
    const angle = (i / ANGLES) * Math.PI * 2;
    let best = 0;
    for (let d = -RADIAL_WINDOW; d <= RADIAL_WINDOW; d += 1) {
      const at = pixelAt(
        h,
        CENTRE.x + Math.cos(angle) * (radius + d),
        CENTRE.y + Math.sin(angle) * (radius + d),
      );
      best = Math.max(best, colorDistance(at, floor));
    }
    if (best >= APART_MIN) marked += 1;
  }
  return marked / ANGLES;
}

/** Both readings of the frame on the canvas, and the floor they were taken over. */
function readRing(h: Harness): { on: number; off: number; floor: Rgb } {
  const floor = floorReading(h);
  return {
    on: ringFraction(h, RADIUS, floor),
    off: ringFraction(h, RADIUS * OFF_RING_SCALE, floor),
    floor,
  };
}

/** What a failure names: whose ring, at what radius, and why that radius. */
function because(whose: string, floor: Rgb): string {
  return (
    `${whose}: the proportion of the circle ${RANGE} tiles (${RADIUS} units) ` +
    `from the footprint's centre carrying a mark at least ${APART_MIN} of 441 ` +
    `from the floor around it (${showRgb(floor)}) (specs/building.md: a range ` +
    `ring at the tower's range, centred on the footprint's centre; ` +
    `specs/towers.md: an ${TYPE}'s range is ${RANGE})`
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a ring at the held type's range around a held preview", async () => {
  startRun(h);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(COL, ROW);
  await h.advance(1);
  captureStill(h, "ring");

  const { on, off, floor } = readRing(h);
  assertGreaterThanOrEqual(on, ON_RING_MIN, because("a held preview", floor));
  assertLessThanOrEqual(
    off,
    OFF_RING_MAX,
    `${because("a held preview", floor)}, read instead at ${OFF_RING_SCALE} ` +
      `times that radius, where a ring drawn at the range puts nothing`,
  );
});
