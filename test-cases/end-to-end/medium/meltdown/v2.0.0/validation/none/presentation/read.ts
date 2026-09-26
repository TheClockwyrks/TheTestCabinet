// presentation — reading the picture, for the checks in this group that decide
// whether the build drew something where the specification says something is
// drawn.
//
// WHAT THIS GROUP READS, AND WHAT IT NEVER READS. `specs/overview.md` fixes no
// palette: "The palette, the type, the glow, and every other aspect of the
// look are yours." So no reading in this group is a colour, a contrast, or a
// distance between two things the build drew. A reading is one of two shapes:
// the patch the specification puts a thing on differs from the same patch with
// that thing taken away through the debug surface, or the patch changes when one
// thing about the world changes. Either way the build's own art cancels between
// the two frames and what is left is what the build drew for the requirement.
//
// HOW FAR A READING HAS TO MOVE. Not a stated distance. A build animates — a
// glow pulses, a scanline creeps — so how much the picture moves on its own is
// MEASURED, by reading the same points on two frames with nothing changed, and a
// reading has to beat that measurement by {@link NOISE_MARGIN}.
//
// WHY RAW PIXELS AND NOT `sampleColor`. The harness's `sampleColor` averages a
// five-point cluster four units wide. That is right for "what colour is a tower"
// and wrong for most of this group: a radiator face is a band a few units deep, a
// surge Swarm is a few units across, and a range ring is a hairline. So the
// readings here are single pixels, gathered in batches and reduced by the
// summaries below.
//
// THE SUMMARIES, AND WHY THEY ARE NOT AVERAGES. An average of a set of pixels
// over a tower's body is dragged about by whatever else the build drew there — the
// label on the footprint, the heat read across it — and an average of a set over a
// surge unit is dragged toward the floor showing between the unit's edges. So:
//
//   - {@link widestGap} answers "did anything here move", by taking the position
//     at which two readings of the same points diverge most. A mark one pixel
//     wide still reads, and a failure names where it was looked for.
//   - {@link medoid} answers "what colour is MOST of this patch", for the checks
//     that need a reference to read a patch AGAINST rather than a verdict.
//   - {@link farthest} answers "what is drawn HERE at all", by taking the sample
//     furthest from a reference the check names. A hollow silhouette, a unit
//     smaller than the patch, or a ring one pixel wide all still read.
//
// WHY IT IS LOCAL TO THIS GROUP. None of it is a threshold and none of it is a
// scenario: every figure a check leans on is declared in the check, with its
// derivation from the specification beside it. This is the batching and the
// summaries the group shares, and no other group reads the picture this way.

import { SIDES, TILE, tileLeft, tileTop } from "../constants";
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
 * How far above the movement two unchanged frames show a reading must sit for
 * the build to count as having drawn something, out of the 441 the RGB cube
 * spans.
 *
 * NOT A LEGIBILITY BAR. `specs/overview.md` gives the palette, the glow and
 * every other aspect of the look to the build, so no figure here says how far
 * apart two things a build drew must read. This is the tolerance on the noise
 * measurement itself: two frames of an animated build do not move by exactly the
 * same amount every pair, so a reading has to clear the measured movement by a
 * little rather than by nothing. Eight units is under two per cent of the scale
 * — far below anything a player would call a difference, and far above the
 * rounding a repeated read of an unchanged frame shows.
 */
export const NOISE_MARGIN = 8;

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
 * The reading behind every "something changed here" check over a patch rather
 * than a point: the two runs are the SAME points read on two frames, so the
 * largest distance between a pair is the strongest movement anywhere in the
 * patch, and where it fell is what a failure names. Everything the build drew
 * that did not change cancels, so the reading is about the one thing that did.
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

/** How far from a unit's centre its own pixels are looked for: half a tile. */
const UNIT_REACH = TILE / 2;

/**
 * A cross of points over the tile a surge unit stands on.
 *
 * `specs/surge.md` fixes a unit's position as its centre and fixes NOTHING about
 * how big it is drawn or what shape — "the radius the unit is drawn at" is the
 * build's. A patch a few units wide therefore reads the FLOOR on a build that
 * draws a big unit as a ring, so the reach is half a tile: the tile the unit
 * stands on, short of its neighbours and of anything drawn above it. It is
 * reduced by {@link widestGap} rather than averaged, so a unit drawn as an
 * outline reads as its outline rather than as the floor showing between its
 * edges.
 */
export function unitPoints(unit: UnitView): Point[] {
  const points: Point[] = [{ x: unit.x, y: unit.y }];
  for (let d = 1; d <= UNIT_REACH; d += 1) {
    points.push(
      { x: unit.x + d, y: unit.y },
      { x: unit.x - d, y: unit.y },
      { x: unit.x, y: unit.y + d },
      { x: unit.x, y: unit.y - d },
      { x: unit.x + d, y: unit.y + d },
      { x: unit.x - d, y: unit.y - d },
      { x: unit.x + d, y: unit.y - d },
      { x: unit.x - d, y: unit.y + d },
    );
  }
  return points;
}
