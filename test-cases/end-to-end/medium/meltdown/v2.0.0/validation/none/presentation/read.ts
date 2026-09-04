// presentation — reading colour off the canvas, for the fourteen checks in this
// group that decide whether a player can tell two things apart.
//
// WHAT THIS GROUP MEASURES, AND WHAT IT NEVER MEASURES. `specs/overview.md` fixes
// no palette: "The palette, the type, the glow, and every other aspect of the
// look are yours." What it fixes instead is a table of things a player "reads at
// a glance". So every reading in this group is a DISTANCE between two things the
// same build drew, out of the 441 the RGB cube spans, and no check anywhere in it
// names a colour. A build that draws its reactor in greys and its surge in pastels
// passes exactly where a build that draws them in neon does.
//
// WHY RAW PIXELS AND NOT `sampleColor`. The harness's `sampleColor` averages a
// five-point cluster four units wide. That is right for "what colour is a tower"
// and wrong for most of this group: a radiator face is a band a few units deep, a
// surge Swarm is a few units across, and a range ring is a hairline. So the
// readings here are single pixels, gathered in batches and reduced by the two
// summaries below.
//
// THE TWO SUMMARIES, AND WHY THEY ARE NOT AVERAGES. An average of a set of pixels
// over a tower's body is dragged about by whatever else the build drew there — the
// label on the footprint, the heat read across it — and an average of a set over a
// surge unit is dragged toward the floor showing between the unit's edges. So:
//
//   - {@link medoid} answers "what colour is MOST of this patch", by taking the
//     sample nearest all the others. A patch with two furniture pixels in twelve
//     still reads as its own body.
//   - {@link farthest} answers "what is drawn HERE at all", by taking the sample
//     furthest from a reference the check names. A hollow silhouette, a unit
//     smaller than the patch, or a ring one pixel wide all still read.
//
// WHY IT IS LOCAL TO THIS GROUP. None of it is a threshold and none of it is a
// scenario: every figure a check leans on is declared in the check, with its
// derivation from the specification beside it. This is the batching and the two
// summaries the fourteen share, and no other group reads colour this way.

import { SIDES, TILE, tileCX, tileCY, tileLeft, tileTop } from "../constants";
import type { Side } from "../constants";
import { colorDistance } from "../harness";
import type { Harness, Rgb, TowerView, UnitView } from "../harness";

/** A logical stage point. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The single device pixel under each logical point, in one crossing into the
 * page.
 *
 * The points are mapped through the fit `specs/overview.md` requires, so a build
 * that scaled, cropped or centred the stage differently is read where the
 * specification says the thing should be rather than where the build put it.
 */
export async function readPixels(
  h: Harness,
  points: readonly Point[],
): Promise<Rgb[]> {
  const read = await h.pixels(points);
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/** {@link readPixels} for one point. */
export async function readPixel(h: Harness, point: Point): Promise<Rgb> {
  return (await readPixels(h, [point]))[0];
}

/** A colour, rendered for a failure message. */
export function showRgb(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

/**
 * The colour most of a patch shows: the sample nearest all the others.
 *
 * Not the mean, because the mean of a patch is moved by everything drawn over it
 * — a label on a footprint, a heat read across it — while the sample nearest all
 * the others is the patch's own ground until the furniture outnumbers it.
 */
export function medoid(colors: readonly Rgb[]): Rgb {
  let best = colors[0];
  let bestTotal = Infinity;
  for (const candidate of colors) {
    let total = 0;
    for (const other of colors) total += colorDistance(candidate, other);
    if (total < bestTotal) {
      bestTotal = total;
      best = candidate;
    }
  }
  return best;
}

/** The sample furthest from `reference`: what is drawn in a patch at all. */
export function farthest(reference: Rgb, colors: readonly Rgb[]): Rgb {
  let best = colors[0];
  let bestDistance = -1;
  for (const candidate of colors) {
    const distance = colorDistance(candidate, reference);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** The nearest of `colors` to `reference`: a comparison's worst case. */
export function nearest(reference: Rgb, colors: readonly Rgb[]): Rgb {
  let best = colors[0];
  let bestDistance = Infinity;
  for (const candidate of colors) {
    const distance = colorDistance(candidate, reference);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** How far the two readings at some one position sit apart, and where. */
export interface Divergence {
  distance: number;
  index: number;
  left: Rgb;
  right: Rgb;
}

/**
 * The position at which two equal-length runs of samples diverge most.
 *
 * The reading behind every "these two read apart" comparison over a patch rather
 * than a point: the two runs cover the same positions, so the largest distance
 * between a pair is the strongest difference a player could see anywhere in the
 * patch, and where it fell is what a failure names.
 */
export function widestGap(
  left: readonly Rgb[],
  right: readonly Rgb[],
): Divergence {
  let best: Divergence = {
    distance: -1,
    index: 0,
    left: left[0],
    right: right[0],
  };
  for (let index = 0; index < left.length; index += 1) {
    const distance = colorDistance(left[index], right[index]);
    if (distance > best.distance) {
      best = { distance, index, left: left[index], right: right[index] };
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* A tower                                                                    */
/* -------------------------------------------------------------------------- */

/** How far out of the footprint's half-width the body ring is read at. */
const BODY_RING_FRACTION = 0.3;
/** How many points the body ring carries. */
const BODY_RING_POINTS = 12;

/**
 * A ring of points inside a tower's body, well clear of both its edges and its
 * centre.
 *
 * `specs/floor.md` fixes the footprint — `size x size` tiles anchored at
 * `(col, row)` — and that is all a check may assume about where a tower's own
 * pixels are. So the ring sits at 30% of the footprint's half-width from its
 * centre: outside the centre, where `specs/hud.md` lets a build draw a heat read
 * and a build commonly draws a label, and a long way inside the faces, where
 * `specs/towers.md` puts the radiator marking. Twelve points, reduced by
 * {@link medoid}, so the two or three that do land on furniture cannot move the
 * reading.
 */
export function bodyPoints(tower: TowerView): Point[] {
  const centre = {
    x: tileLeft(tower.col) + (tower.size * TILE) / 2,
    y: tileTop(tower.row) + (tower.size * TILE) / 2,
  };
  const radius = ((tower.size * TILE) / 2) * BODY_RING_FRACTION;
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

/** The colour a tower's body shows: {@link medoid} over {@link bodyPoints}. */
export async function bodyColor(h: Harness, tower: TowerView): Promise<Rgb> {
  return medoid(await readPixels(h, bodyPoints(tower)));
}

/** How far clear of a footprint the floor beside it is read, in tiles. */
const FLOOR_PROBE_GAP = 2;

/**
 * Four tile centres on the open floor around a footprint, one off each side.
 *
 * `FLOOR_PROBE_GAP` tiles clear of the footprint, so nothing a build draws
 * hugging its towers — a shadow, a base plate, a glow — is read as the floor,
 * and at tile centres, so the grid `specs/floor.md` puts on every tile boundary
 * is not either.
 */
export function floorProbePoints(tower: TowerView): Point[] {
  const gap = FLOOR_PROBE_GAP;
  const far = tower.size + gap;
  return [
    { x: tileCX(tower.col - gap - 1), y: tileCY(tower.row) },
    { x: tileCX(tower.col + far), y: tileCY(tower.row) },
    { x: tileCX(tower.col), y: tileCY(tower.row - gap - 1) },
    { x: tileCX(tower.col), y: tileCY(tower.row + far) },
  ];
}

/* -------------------------------------------------------------------------- */
/* A tower's faces                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Where along a face, as a fraction of its length, the band is read.
 *
 * The middle of the run rather than its ends, because `specs/heat.md` counts a
 * face in edge-tiles and the corners belong to two faces at once.
 */
export const FACE_ALONGS: readonly number[] = [0.3, 0.5, 0.7];

/**
 * How deep into the footprint, in logical units, the band is read — and a
 * little way outside it.
 *
 * `specs/towers.md` says a tower "designates some of its faces as radiator
 * faces" and `specs/overview.md` that they are "drawn distinctly from its plain
 * faces"; neither says how thick that marking is or which side of the footprint's
 * edge it sits on. So the band runs from two units outside the edge to five
 * inside — deep enough for a rim, a bar or a glow, and nowhere near the centre,
 * where a heat read and a label live.
 */
export const FACE_DEPTHS: readonly number[] = [-2, -1, 0, 1, 2, 3, 4, 5];

/**
 * The band along one world face of a tower, in face-local order.
 *
 * The parameterisation is the square's own quarter-turn: `along` runs clockwise
 * from the corner the face starts at, and `depth` runs inward. `specs/towers.md`
 * fixes that "a footprint's size and shape are the same at every rotation" and
 * that a rotation turns a local face `N -> E -> S -> W`, so the same
 * `(along, depth)` on two different faces names the two points a quarter-turn
 * carries onto each other — which is what makes one face's band directly
 * comparable with another's.
 */
export function facePoints(
  tower: TowerView,
  side: Side,
  alongs: readonly number[] = FACE_ALONGS,
  depths: readonly number[] = FACE_DEPTHS,
): Point[] {
  const x0 = tileLeft(tower.col);
  const y0 = tileTop(tower.row);
  const w = tower.size * TILE;
  const points: Point[] = [];
  for (const fraction of alongs) {
    const a = fraction * w;
    for (const d of depths) {
      if (side === "N") points.push({ x: x0 + a, y: y0 + d });
      else if (side === "E") points.push({ x: x0 + w - d, y: y0 + a });
      else if (side === "S") points.push({ x: x0 + w - a, y: y0 + w - d });
      else points.push({ x: x0 + d, y: y0 + w - a });
    }
  }
  return points;
}

/** The four world faces' bands, read in one crossing, keyed by side. */
export async function faceBands(
  h: Harness,
  tower: TowerView,
): Promise<Record<Side, Rgb[]>> {
  const points: Point[] = [];
  for (const side of SIDES) points.push(...facePoints(tower, side));
  const read = await readPixels(h, points);
  const stride = read.length / SIDES.length;
  const bands = {} as Record<Side, Rgb[]>;
  for (const [index, side] of SIDES.entries()) {
    bands[side] = read.slice(index * stride, (index + 1) * stride);
  }
  return bands;
}

/* -------------------------------------------------------------------------- */
/* A surge unit                                                               */
/* -------------------------------------------------------------------------- */

/** How far from a unit's centre its own pixels are looked for, in units. */
const UNIT_REACH = 3;

/**
 * A small cross of points on a surge unit's centre.
 *
 * `specs/surge.md` fixes a unit's position as its centre and fixes NOTHING about
 * how big it is drawn or what shape — "the radius the unit is drawn at" is the
 * build's. So the patch is three units either way from the centre, which the
 * smallest thing a player could be expected to see covers, and it is reduced by
 * {@link farthest} against the floor rather than averaged, so a unit drawn as an
 * outline reads as its outline rather than as the floor inside it.
 */
export function unitPoints(unit: UnitView): Point[] {
  const points: Point[] = [{ x: unit.x, y: unit.y }];
  for (let d = 1; d <= UNIT_REACH; d += 1) {
    points.push(
      { x: unit.x + d, y: unit.y },
      { x: unit.x - d, y: unit.y },
      { x: unit.x, y: unit.y + d },
      { x: unit.x, y: unit.y - d },
    );
  }
  return points;
}

/** The colour a unit shows: the pixel on it furthest from the floor under it. */
export async function unitColor(
  h: Harness,
  unit: UnitView,
  floor: Rgb,
): Promise<Rgb> {
  return farthest(floor, await readPixels(h, unitPoints(unit)));
}

/** Four tile centres on the open floor around a unit, one off each side. */
export function unitFloorProbePoints(unit: UnitView): Point[] {
  const gap = FLOOR_PROBE_GAP;
  return [
    { x: tileCX(unit.col - gap), y: tileCY(unit.row) },
    { x: tileCX(unit.col + gap), y: tileCY(unit.row) },
    { x: tileCX(unit.col), y: tileCY(unit.row - gap) },
    { x: tileCX(unit.col), y: tileCY(unit.row + gap) },
  ];
}
