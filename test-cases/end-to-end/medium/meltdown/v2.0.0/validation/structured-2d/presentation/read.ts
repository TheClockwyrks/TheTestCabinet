// presentation — reading the picture as COLOUR, for the checks in this group.
//
// WHY THIS GROUP READS PIXELS AND NOTHING ELSE. specs/overview.md fixes no
// palette and no typeface: "The palette, the type, the glow, and every other
// aspect of the look are yours." What it fixes instead is a table of things a
// player must READ AT A GLANCE, and every row of it is a statement that two
// things look different from each other. So every reading here is a comparison
// between two things the BUILD itself drew, on the 0-441 scale the RGB cube
// spans, and no check in this group ever names a colour.
//
// WHY IT IS LOCAL TO THIS GROUP. `harness.ts` already carries `sampleColor`,
// `sampleTile`, `sampleRegion`, `brightestIn`, `clearColor` and `colorDistance`,
// and the ones this group wants it uses. What is added below is the SHAPE of the
// reading this group needs and no other does: a whole region of the picture read
// at once, what proportion of a region answers a comparison, and the colour a
// region mostly reads as. Nothing here carries a threshold — every distance and
// every proportion is stated in the check that asserts it, derived from what
// specs/ fixes for it.
//
// WHY A REGION AND NOT A POINT. A build draws a tower, a preview or an opening
// however it likes: a body with a label on it, an outline, a bar, a stripe down
// one face. A single sampled point can land on any of those and say nothing
// about what the thing reads as. So a check here reads every pixel of the region
// it cares about and then says, in its own terms, how much of that region has to
// answer for the reading to hold.

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
 * For a thing smaller than a tile — a surge unit, a point in the casing band —
 * where `harness.ts`'s `sampleColor` would reach three units either side and
 * blur the ground in. Two units is the widest cluster that still sits inside the
 * smallest form a player could see at all, and it is wide enough that one stray
 * anti-aliased pixel cannot swing the reading.
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
 * {@link movedFraction} can compare them.
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
 * The colour a region MOSTLY reads as: the mean of its largest cluster of
 * samples, where two samples join one cluster when they are within `sameMax` of
 * each other.
 *
 * How a check asks "what colour is this tower" of a footprint carrying a body, a
 * label, an outline and a bar. The caller states `sameMax`, because how close
 * two readings must be to count as the same reading is a claim about what a
 * player tells apart, and it belongs in the check that makes it.
 */
export function dominant(samples: readonly Rgb[], sameMax: number): Rgb {
  if (samples.length === 0) {
    fail("a region of the stage with pixels in it to read", "no pixels read");
  }
  const clusters: { seed: Rgb; r: number; g: number; b: number; n: number }[] =
    [];
  for (const sample of samples) {
    const found = clusters.find(
      (cluster) => colorDistance(cluster.seed, sample) <= sameMax,
    );
    if (found === undefined) {
      clusters.push({ seed: sample, ...sample, n: 1 });
      continue;
    }
    found.r += sample.r;
    found.g += sample.g;
    found.b += sample.b;
    found.n += 1;
  }
  const best = clusters.reduce((a, b) => (b.n > a.n ? b : a));
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
}

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

/** What proportion of a region sits at least `minDistance` from `reference`. */
export function apartFraction(
  samples: readonly Rgb[],
  reference: Rgb,
  minDistance: number,
): number {
  if (samples.length === 0) {
    fail("a region of the stage with pixels in it to read", "no pixels read");
  }
  const apart = samples.filter(
    (sample) => colorDistance(sample, reference) >= minDistance,
  ).length;
  return apart / samples.length;
}

/**
 * What proportion of a region CHANGED by at least `minDistance` between two
 * frames.
 *
 * The two readings must come from the same region at the same step, so they are
 * point-for-point aligned; a length mismatch is a fault in the check rather than
 * a verdict about the build, so it throws.
 */
export function movedFraction(
  before: readonly Rgb[],
  after: readonly Rgb[],
  minDistance: number,
): number {
  if (before.length === 0 || before.length !== after.length) {
    throw new Error(
      "meltdown presentation/read.ts: movedFraction compares one region read " +
        `on two frames, so the two readings must be the same length; got ` +
        `${before.length} and ${after.length}`,
    );
  }
  let moved = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (colorDistance(before[i], after[i]) >= minDistance) moved += 1;
  }
  return moved / before.length;
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
