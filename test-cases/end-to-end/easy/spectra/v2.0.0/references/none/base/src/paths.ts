// Spectra — the smooth paths an entrance, a dive and a return are flown along.
//
// `specs/swarm.md` asks for a path of the build's own design that is continuous
// and is travelled AT A CONSTANT SPEED along its length, whatever its curvature.
// A {@link Path} is therefore a chain of cubic Béziers sampled into an arc-length
// table: a drone carries how far along the path it has travelled, adds
// `speed * h` to it in every sub-step, and asks the table where that puts it.
//
// Nothing here knows about a drone. Where the knots come from is `src/waves.ts`
// (an entrance and a challenge sweep) and `src/swarm.ts` (a dive and a return).

/** A point in logical stage units. */
export interface Vec2 {
  x: number;
  y: number;
}

/** One cubic Bézier segment. */
interface Cubic {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

/** One sample of a path, carrying the arc length reached at it. */
interface Sample {
  x: number;
  y: number;
  dist: number;
}

/** How finely each segment is sampled. */
const PER_SEGMENT = 24;

/** A curve, parameterized by distance travelled along it. */
export class Path {
  private readonly samples: Sample[] = [];
  /** The path's whole arc length. */
  readonly length: number;

  constructor(segments: readonly Cubic[], perSegment = PER_SEGMENT) {
    let travelled = 0;
    let previous: Vec2 | null = null;
    for (let s = 0; s < segments.length; s += 1) {
      const segment = segments[s];
      if (segment === undefined) continue;
      // The shared knot between two segments is sampled once, not twice.
      const first = s === 0 ? 0 : 1;
      for (let i = first; i <= perSegment; i += 1) {
        const point = cubicAt(segment, i / perSegment);
        if (previous !== null) {
          travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
        }
        this.samples.push({ x: point.x, y: point.y, dist: travelled });
        previous = point;
      }
    }
    this.length = travelled;
  }

  /** The point at arc length `d`, clamped to the path's two ends. */
  at(d: number): Vec2 {
    const samples = this.samples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) return { x: 0, y: 0 };
    if (!(d > 0)) return { x: first.x, y: first.y };
    if (d >= last.dist) return { x: last.x, y: last.y };

    // Binary search for the pair of samples `d` falls between.
    let low = 0;
    let high = samples.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      const sample = samples[mid];
      if (sample !== undefined && sample.dist <= d) low = mid;
      else high = mid;
    }
    const a = samples[low];
    const b = samples[high];
    if (a === undefined || b === undefined) return { x: last.x, y: last.y };
    const span = b.dist - a.dist || 1;
    const f = (d - a.dist) / span;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

/** One cubic Bézier evaluated at `t` in `[0, 1]`. */
function cubicAt(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

/**
 * A path through every knot, smoothed with Catmull-Rom tangents so the curve
 * flows through the knots without a kink at any of them.
 */
export function smoothPath(knots: readonly Vec2[]): Path {
  const only = knots[0] ?? { x: 0, y: 0 };
  if (knots.length < 2) {
    return new Path([{ p0: only, p1: only, p2: only, p3: only }]);
  }
  const segments: Cubic[] = [];
  for (let i = 0; i < knots.length - 1; i += 1) {
    const p0 = knots[Math.max(0, i - 1)] ?? only;
    const p1 = knots[i] ?? only;
    const p2 = knots[i + 1] ?? only;
    const p3 = knots[Math.min(knots.length - 1, i + 2)] ?? only;
    segments.push({
      p0: p1,
      p1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      p2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p3: p2,
    });
  }
  return new Path(segments);
}
