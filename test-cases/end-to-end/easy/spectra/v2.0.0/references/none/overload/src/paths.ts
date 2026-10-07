// Spectra — the curved paths an entrance, a dive and a return are flown along.
//
// `specs/swarm.md` fixes the SPEED along a path and leaves the path's shape to the
// build: an entrance is "a smooth path of your design", a dive "a smooth swooping
// path of your design". Both are stated as travel at so many units per second
// ALONG THE PATH, which is what this module exists for: a chain of Catmull-Rom
// smoothed cubics sampled into an arc-length table, so advancing a drone by
// `speed * h` moves it that far along the curve whatever the local curvature is.
//
// That is what makes `swarm.entrance-speed` and `swarm.dive-speed` decidable
// against a curved path at all: without the arc-length table a drone would race
// through the straight sections and crawl round the bends.
//
// Every path in this build is CONTINUOUS. A dive turns back above the field's
// bottom edge rather than wrapping through it, which is one of the two endings
// `specs/swarm.md` allows and the one that holds no discontinuity at all.

/** A point in the stage's logical units. */
export interface Vec2 {
  x: number;
  y: number;
}

/** One cubic Bezier segment. */
interface Cubic {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

/** One sample of a path: a point and the arc length reached at it. */
interface Sample {
  x: number;
  y: number;
  dist: number;
}

/** How many samples each segment is measured with. */
const SAMPLES_PER_SEGMENT = 24;

/** A point on one cubic at parameter `t`. */
function cubicAt(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const cc = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + cc * c.p2.x + d * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + cc * c.p2.y + d * c.p3.y,
  };
}

/** What a path may be bounded by as it is measured. */
export interface PathBounds {
  /**
   * The largest `y` any point of the path may reach.
   *
   * A smoothed curve overshoots a knot it turns at by a few units, and a dive's
   * turn sits a few units above the bottom of the play field. Clamping the SAMPLES
   * — before the arc length is accumulated over them — bounds the curve without
   * costing the constant speed along it, which a clamp applied afterwards would.
   */
  maxY?: number;
}

/** A smooth curve through a chain of knots, addressed by arc length. */
export class Path {
  private readonly samples: Sample[] = [];
  /** The whole path's arc length, in logical units. */
  readonly length: number;

  constructor(segments: readonly Cubic[], bounds: PathBounds = {}) {
    const ceiling = bounds.maxY ?? Number.POSITIVE_INFINITY;
    let travelled = 0;
    let previous: Vec2 | null = null;
    segments.forEach((segment, index) => {
      // The knot two neighbouring segments share is sampled once.
      const first = index === 0 ? 0 : 1;
      for (let step = first; step <= SAMPLES_PER_SEGMENT; step += 1) {
        const raw = cubicAt(segment, step / SAMPLES_PER_SEGMENT);
        const point = { x: raw.x, y: Math.min(raw.y, ceiling) };
        if (previous !== null) {
          travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
        }
        this.samples.push({ x: point.x, y: point.y, dist: travelled });
        previous = point;
      }
    });
    this.length = travelled;
  }

  /** The point at arc length `d`, clamped to the path's two ends. */
  at(d: number): Vec2 {
    const samples = this.samples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) return { x: 0, y: 0 };
    if (d <= 0) return { x: first.x, y: first.y };
    if (d >= last.dist) return { x: last.x, y: last.y };
    let lo = 0;
    let hi = samples.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if ((samples[mid] as Sample).dist <= d) lo = mid;
      else hi = mid;
    }
    const a = samples[lo] as Sample;
    const b = samples[hi] as Sample;
    const span = b.dist - a.dist || 1;
    const f = (d - a.dist) / span;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

/**
 * A smooth path through every knot, with Catmull-Rom tangents.
 *
 * The curve flows through each knot without a kink, which is what "continuous"
 * means for `swarm.entrance-continuous` and `swarm.dive-continuous`: sampled every
 * frame, a drone never jumps further than one frame's travel.
 */
export function smoothPath(
  knots: readonly Vec2[],
  bounds: PathBounds = {},
): Path {
  const first = knots[0];
  if (knots.length < 2 || first === undefined) {
    const point = first ?? { x: 0, y: 0 };
    return new Path([{ p0: point, p1: point, p2: point, p3: point }], bounds);
  }
  const segments: Cubic[] = [];
  for (let index = 0; index < knots.length - 1; index += 1) {
    const before = knots[Math.max(0, index - 1)] as Vec2;
    const start = knots[index] as Vec2;
    const end = knots[index + 1] as Vec2;
    const after = knots[Math.min(knots.length - 1, index + 2)] as Vec2;
    segments.push({
      p0: start,
      p1: {
        x: start.x + (end.x - before.x) / 6,
        y: start.y + (end.y - before.y) / 6,
      },
      p2: {
        x: end.x - (after.x - start.x) / 6,
        y: end.y - (after.y - start.y) / 6,
      },
      p3: end,
    });
  }
  return new Path(segments, bounds);
}
