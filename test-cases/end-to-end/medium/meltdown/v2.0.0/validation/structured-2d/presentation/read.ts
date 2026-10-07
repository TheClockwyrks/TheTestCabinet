// presentation — reading the picture, for the checks in this group that decide
// whether the build drew something where the specification says something is
// drawn.
//
// WHAT THIS GROUP READS, AND WHAT IT NEVER READS. specs/overview.md fixes no
// palette and no typeface: "The palette, the type, the glow, and every other
// aspect of the look are yours." So no reading in this group is a colour, a
// contrast, or a distance between two things the build drew. Every distance
// below is on the 0-441 scale the RGB cube spans, and every one of them is
// between two readings of the SAME region.
//
// WHAT A READING IS ALLOWED TO BE. A comparison between two things the build drew
// is appearance, and specs/overview.md gives appearance to the build. So a
// reading in this group is one of two shapes: the region the specification puts a
// thing on differs from the same region with that thing taken away through the
// debug surface, or the region changes when one thing about the world changes.
// How far it has to change is MEASURED rather than stated — the same region read
// on two frames with nothing changed is how far the picture moves on its own, and
// a reading has to beat that by {@link NOISE_MARGIN}.
//
// WHY IT IS LOCAL TO THIS GROUP. `harness.ts` already carries `sampleColor`,
// `sampleTile`, `sampleRegion`, `brightestIn`, `clearColor` and `colorDistance`,
// and the ones this group wants it uses. What is added below is the SHAPE of the
// reading this group needs and no other does: a whole region of the picture read
// at once, a ring of points inside a footprint, the colour a region mostly reads
// as, and how far one set of points moved between two frames. The only figure any
// of it carries is {@link NOISE_MARGIN}, and that is a tolerance on a measurement
// rather than a bar a build is held to.
//
// WHY A REGION AND NOT A POINT. A build draws a tower, a preview or an opening
// however it likes: a body with a label on it, an outline, a bar, a stripe down
// one face. A single sampled point can land on any of those and say nothing about
// what the thing reads as. So a check here reads every pixel of the region it
// cares about, and what it takes from two readings of that region is the point at
// which they diverge MOST: a mark one pixel wide still reads, and a build that
// drew nothing there moves no point at all.

import { fail } from "../assert";
import { TILE, tileLeft, tileTop } from "../constants";
import type {
  Face,
  Harness,
  MeltdownSnapshot,
  Rgb,
  TowerSnapshot,
  UnitSnapshot,
} from "../harness";
import { colorDistance, towerById, unitById } from "../harness";

/* -------------------------------------------------------------------------- */
/* Reading the canvas                                                         */
/* -------------------------------------------------------------------------- */

/** A rectangle of the stage, in logical units. */
export interface Region {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The one device pixel under a logical stage point.
 *
 * The point is mapped through the engine's own fit, so a reading is taken where
 * the specification says the thing should be rather than wherever the canvas
 * happens to be that many pixels along.
 */
export function pixelAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/**
 * The colour AT a point, averaged over the centre pixel and four neighbours two
 * units out.
 *
 * For a thing narrower than a tile — a point in the casing band between a vent's
 * cut and the wall either side of it — where `harness.ts`'s `sampleColor` would
 * reach three units either side and blur the neighbouring form in. Two units is
 * the widest cluster that still sits inside the smallest form a player could see
 * at all, and it is wide enough that one stray anti-aliased pixel cannot swing
 * the reading. `vents-and-exhausts-read-apart` is its one caller; a surge unit is
 * read over the whole TILE it stands on instead, by
 * `surge-reads-apart-from-the-floor`'s own reader.
 */
export function spotColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const [pr, pg, pb] = h.pixel(x + dx, y + dy);
    r += pr;
    g += pg;
    b += pb;
  }
  return {
    r: r / offsets.length,
    g: g / offsets.length,
    b: b / offsets.length,
  };
}

/**
 * Every pixel of a region of the stage, in row-major order, one sample every
 * `step` logical units.
 *
 * ONE `getImageData` over the whole region rather than one call per point,
 * because a check here reads thousands of pixels and the region is contiguous.
 * The order is fixed by the region and the step alone, so the same region read
 * on two different frames comes back point-for-point aligned and
 * {@link largestShift} can compare them.
 */
export function readRegion(h: Harness, region: Region, step = 1): Rgb[] {
  const near = h.device(region.left, region.top);
  const far = h.device(region.right, region.bottom);
  const unit = h.device(region.left + 1, region.top).x - near.x;
  const stride = Math.max(1, Math.round(step * Math.abs(unit)));

  const x0 = Math.max(0, Math.round(Math.min(near.x, far.x)));
  const y0 = Math.max(0, Math.round(Math.min(near.y, far.y)));
  const x1 = Math.min(h.canvas.width, Math.round(Math.max(near.x, far.x)));
  const y1 = Math.min(h.canvas.height, Math.round(Math.max(near.y, far.y)));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return [];

  const { data } = h.ctx.getImageData(x0, y0, width, height);
  const read: Rgb[] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      read.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  return read;
}

/* -------------------------------------------------------------------------- */
/* Where a region is                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A tower's footprint, inset by `inset` units on all four sides.
 *
 * The inset exists so a reading is about what the build drew ON the footprint
 * rather than about the anti-aliased seam where the footprint meets the floor.
 * specs/floor.md fixes the footprint's extent; nothing fixes how its edge is
 * finished.
 */
export function footprintRegion(
  col: number,
  row: number,
  size: number,
  inset: number,
): Region {
  const left = tileLeft(col);
  const top = tileTop(row);
  const span = size * TILE;
  return {
    left: left + inset,
    top: top + inset,
    right: left + span - inset,
    bottom: top + span - inset,
  };
}

/**
 * The band just inside one world face of a footprint.
 *
 * A face is one edge of the footprint (specs/heat.md, Faces, edge-tiles and
 * neighbours), so the band that reads it runs along that edge, `fromDepth` to
 * `toDepth` units in from it, over the stretch of the face from `alongFrom` to
 * `alongTo` of its length. A check states both, and says why: the depth decides
 * what part of the face the reading is of, and the stretch decides how much of
 * the face's own length it reads rather than the corners it shares with its
 * neighbours.
 */
export function faceBand(
  col: number,
  row: number,
  size: number,
  face: Face,
  fromDepth: number,
  toDepth: number,
  alongFrom: number,
  alongTo: number,
): Region {
  const left = tileLeft(col);
  const top = tileTop(row);
  const span = size * TILE;
  const from = alongFrom * span;
  const to = alongTo * span;
  if (face === "N") {
    return {
      left: left + from,
      top: top + fromDepth,
      right: left + to,
      bottom: top + toDepth,
    };
  }
  if (face === "S") {
    return {
      left: left + from,
      top: top + span - toDepth,
      right: left + to,
      bottom: top + span - fromDepth,
    };
  }
  if (face === "W") {
    return {
      left: left + fromDepth,
      top: top + from,
      right: left + toDepth,
      bottom: top + to,
    };
  }
  return {
    left: left + span - toDepth,
    top: top + from,
    right: left + span - fromDepth,
    bottom: top + to,
  };
}

/* -------------------------------------------------------------------------- */
/* Turning a region into a reading                                            */
/* -------------------------------------------------------------------------- */

/**
 * The colour a set of samples shows MOST OFTEN, exactly.
 *
 * The reading for a box a mark was laid in — a run of text on its panel — where
 * what is wanted is the ground the mark sits on rather than a mean over the two.
 * A mark covers a minority of the box that holds it whatever its shape, so the
 * commonest exact colour in that box is the ground behind it.
 */
export function modal(samples: readonly Rgb[]): Rgb {
  if (samples.length === 0) {
    fail("a region of the stage with pixels in it to read", "no pixels read");
  }
  const counts = new Map<string, { colour: Rgb; n: number }>();
  for (const colour of samples) {
    const key = `${colour.r},${colour.g},${colour.b}`;
    const seen = counts.get(key);
    if (seen === undefined) counts.set(key, { colour, n: 1 });
    else seen.n += 1;
  }
  let best = { colour: samples[0], n: 0 };
  for (const entry of counts.values()) if (entry.n > best.n) best = entry;
  return best.colour;
}

/** The sample furthest from `from`: the strongest mark left on a ground. */
export function furthestFrom(samples: readonly Rgb[], from: Rgb): Rgb {
  if (samples.length === 0) {
    fail("a region of the stage with pixels in it to read", "no pixels read");
  }
  let colour = samples[0];
  let distance = -1;
  for (const sample of samples) {
    const found = colorDistance(sample, from);
    if (found > distance) {
      distance = found;
      colour = sample;
    }
  }
  return colour;
}

/** A colour, rendered for a failure message. */
export function showRgb(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

/* -------------------------------------------------------------------------- */
/* Reading the roster strictly                                                */
/* -------------------------------------------------------------------------- */

/**
 * The unit carrying `id`, or a failure saying the roster no longer holds it.
 *
 * A check that posed a unit to look at it and then found it gone has found a
 * different failure from whatever it went on to read, so it is named as one here
 * rather than surfacing as a reading taken off `undefined`.
 */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(
      `a unit with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.surge.map((entry) => entry.id),
    );
  }
  return unit;
}

/** The tower carrying `id`, or a failure saying the roster no longer holds it. */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(
      `a tower with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.towers.map((entry) => entry.id),
    );
  }
  return tower;
}

/* -------------------------------------------------------------------------- */
/* Reading a change                                                           */
/* -------------------------------------------------------------------------- */

/**
 * How far above the movement two unchanged frames show a reading must sit for
 * the build to count as having drawn something, out of the 441 the RGB cube
 * spans.
 *
 * NOT A LEGIBILITY BAR. specs/overview.md gives the palette, the glow and every
 * other aspect of the look to the build, so no figure here says how far apart two
 * things a build drew must read. This is the tolerance on the noise measurement
 * itself: two frames of an animated build do not move by exactly the same amount
 * every pair, so a reading has to clear the measured movement by a little rather
 * than by nothing. Eight units is under two per cent of the scale — far below
 * anything a player would call a difference, and far above the rounding a
 * repeated read of an unchanged frame shows.
 */
export const NOISE_MARGIN = 8;

/** A logical stage point. */
export interface Point {
  x: number;
  y: number;
}

/** How far out of the footprint's half-width the body ring is read at. */
const BODY_RING_FRACTION = 0.3;
/** How many points the body ring carries. */
const BODY_RING_POINTS = 12;

/**
 * A ring of points inside a tower's body, well clear of both its edges and its
 * centre.
 *
 * specs/floor.md fixes the footprint — `size x size` tiles anchored at
 * `(col, row)` — and that is all a check may assume about where a tower's own
 * pixels are. So the ring sits at 30% of the footprint's half-width from its
 * centre: outside the centre, where specs/hud.md lets a build draw a heat read
 * and a build commonly draws a label, and a long way inside the faces, where
 * specs/towers.md puts the radiator marking and where reopening a tile moves a
 * route overlay.
 */
export function bodyRing(col: number, row: number, size: number): Point[] {
  const span = size * TILE;
  const centre = { x: tileLeft(col) + span / 2, y: tileTop(row) + span / 2 };
  const radius = (span / 2) * BODY_RING_FRACTION;
  const points: Point[] = [];
  for (let n = 0; n < BODY_RING_POINTS; n += 1) {
    const theta = (2 * Math.PI * n) / BODY_RING_POINTS;
    points.push({
      x: centre.x + radius * Math.cos(theta),
      y: centre.y + radius * Math.sin(theta),
    });
  }
  return points;
}

/** The device pixel under each of a run of logical points, in order. */
export function readPoints(h: Harness, points: readonly Point[]): Rgb[] {
  return points.map((point) => pixelAt(h, point.x, point.y));
}

/**
 * The largest distance between two equal-length readings of the same points.
 *
 * The reading behind every "something changed here" check in this group: the two
 * runs are the SAME points read on two frames, so everything the build drew that
 * did not change cancels and what is left is the one thing that did. A length
 * mismatch is a fault in the check rather than a verdict about the build, so it
 * throws.
 */
export function largestShift(
  before: readonly Rgb[],
  after: readonly Rgb[],
): number {
  if (before.length === 0 || before.length !== after.length) {
    throw new Error(
      "meltdown presentation/read.ts: largestShift compares one set of points " +
        "read on two frames, so the two readings must be the same length; got " +
        `${before.length} and ${after.length}`,
    );
  }
  let most = 0;
  for (let i = 0; i < before.length; i += 1) {
    most = Math.max(most, colorDistance(before[i], after[i]));
  }
  return most;
}
