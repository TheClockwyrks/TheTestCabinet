// Deepcore — the pixel readings the rendering checks share. CASE-PROVIDED.
//
// `specs/overview.md` fixes no palette. What a build draws the rock, the ore,
// the lava and the carved tunnels in is its own, and the specification asks only
// that a player TELLS THEM APART. So nothing here carries a colour of its own
// and nothing reads the reference: every reading below is either one sampled
// patch against another sampled in the same frame, or the DISPLACEMENT of the
// same screen points between two frames.
//
// Two readings the checks are built from:
//
//   - {@link meanAt} and {@link nearer}, for the shaping checks. A carved cell's
//     lip, the seam between two joined cells and the nub at a bend are all read
//     as "this point is nearer the band dirt than the tunnel fill", with both
//     ends of that comparison sampled from the same posed scene.
//   - {@link readLuma} and {@link bestShift}, for the screen shake. A jitter of
//     the drawn world moves the picture under a FIXED run of screen points, and
//     the shift that best realigns one frame's profile onto another's is how far
//     it moved. A flash or a fade changes the levels along the profile without
//     moving its structure, so this reads displacement rather than brightness.
//
// THE ENGINE SEAM. Under `simple-2d` a pixel comes back synchronously off the
// canvas the harness handed the engine (`h.pixel`), so these are plain functions
// where the engineless project's are promises. Nothing else about them differs:
// a stage point is a stage point under both, because the game applies its own
// camera translate inside `render` and the harness's `worldToStage` is the
// specification's own mapping rather than anything read off the build.

import { type Harness, type Rgb, colorDistance, worldToStage } from "../harness";
import type { DeepcoreSnapshot } from "../harness";

/** A point on the logical stage. */
export interface StagePoint {
  x: number;
  y: number;
}

/** Where a world point is drawn, through the camera the snapshot reports. */
export function stageOf(
  snapshot: DeepcoreSnapshot,
  wx: number,
  wy: number,
): StagePoint {
  return worldToStage(snapshot, wx, wy);
}

/** The mean colour over a run of stage points, read off the frame on the canvas. */
export function meanAt(h: Harness, points: readonly StagePoint[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const point of points) {
    const [pr, pg, pb] = h.pixel(point.x, point.y);
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / points.length, g: g / points.length, b: b / points.length };
}

/**
 * A tight cluster around one stage point: the point itself and four neighbours
 * `spread` units out.
 *
 * Tighter than the harness's own {@link sampleColor} cluster, because these
 * checks read points a few units from a cell's edge, where a wider cluster would
 * straddle the very boundary it is trying to place.
 */
export function cluster(at: StagePoint, spread: number): StagePoint[] {
  return [
    at,
    { x: at.x + spread, y: at.y },
    { x: at.x - spread, y: at.y },
    { x: at.x, y: at.y + spread },
    { x: at.x, y: at.y - spread },
  ];
}

/** Whether `sample` sits nearer `a` than `b`. */
export function nearer(sample: Rgb, a: Rgb, b: Rgb): boolean {
  return colorDistance(sample, a) < colorDistance(sample, b);
}

/** How a sampled point reads, against the two colours the scene established. */
export function readsAs(sample: Rgb, dirt: Rgb, fill: Rgb): "dirt" | "fill" {
  return nearer(sample, dirt, fill) ? "dirt" : "fill";
}

/** Perceived brightness of a sampled colour, 0 to 255. */
export function luma(color: Rgb): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

/** The luminance along a run of stage points, read off the frame on the canvas. */
export function readLuma(h: Harness, points: readonly StagePoint[]): number[] {
  return points.map((point) => {
    const [r, g, b] = h.pixel(point.x, point.y);
    return luma({ r, g, b });
  });
}

/** A run of stage points `count` samples long, one unit apart, from `from`. */
export function runOf(
  from: StagePoint,
  count: number,
  axis: "x" | "y",
): StagePoint[] {
  const points: StagePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push(
      axis === "x"
        ? { x: from.x + i, y: from.y }
        : { x: from.x, y: from.y + i },
    );
  }
  return points;
}

/**
 * How far, in samples, `sample` has slid along the run relative to `reference`.
 *
 * The shift that minimizes the mean squared difference over the overlap, searched
 * over `maxShift` samples either way. A picture that has not moved answers `0`.
 */
export function bestShift(
  reference: readonly number[],
  sample: readonly number[],
  maxShift: number,
): number {
  // Each profile is levelled against its own mean first, so a flash or a fade
  // that lifts the whole picture cannot masquerade as a slide along it.
  const a = levelled(reference);
  const b = levelled(sample);
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let d = -maxShift; d <= maxShift; d += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < a.length; i += 1) {
      const j = i + d;
      if (j < 0 || j >= b.length) continue;
      const delta = b[j] - a[i];
      sum += delta * delta;
      count += 1;
    }
    if (count === 0) continue;
    const score = sum / count;
    // A strict improvement only, so a picture that has not moved answers 0
    // rather than the first shift that ties with it.
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** A profile with its own mean taken out. */
function levelled(profile: readonly number[]): number[] {
  if (profile.length === 0) return [];
  let sum = 0;
  for (const value of profile) sum += value;
  const mean = sum / profile.length;
  return profile.map((value) => value - mean);
}
