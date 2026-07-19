// Spectra — parametric curved paths for entrances and dives.
//
// A Path is a chain of cubic Bezier segments sampled into an arc-length table so
// a drone can travel it at a constant speed (px/s) regardless of segment
// curvature. This is what lets entrances "swoop" and dives "swirl" smoothly
// (specs/playfield.md entry/exit lanes, specs/enemies.md entrances & dives).

export interface Vec2 {
  x: number;
  y: number;
}

interface Cubic {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

interface Sample {
  x: number;
  y: number;
  dist: number; // cumulative arc length at this sample
}

export class Path {
  private samples: Sample[] = [];
  readonly length: number;

  constructor(segments: Cubic[], perSegment = 24) {
    let acc = 0;
    let prev: Vec2 | null = null;
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!;
      const start = s === 0 ? 0 : 1; // avoid duplicating the shared knot
      for (let i = start; i <= perSegment; i++) {
        const t = i / perSegment;
        const p = cubicAt(seg, t);
        if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
        this.samples.push({ x: p.x, y: p.y, dist: acc });
        prev = p;
      }
    }
    this.length = acc;
  }

  // Position at arc-length `d` (clamped to the path's ends).
  at(d: number): Vec2 {
    const s = this.samples;
    if (d <= 0) return { x: s[0]!.x, y: s[0]!.y };
    const last = s[s.length - 1]!;
    if (d >= last.dist) return { x: last.x, y: last.y };
    // Binary search for the segment containing `d`.
    let lo = 0;
    let hi = s.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid]!.dist <= d) lo = mid;
      else hi = mid;
    }
    const a = s[lo]!;
    const b = s[hi]!;
    const span = b.dist - a.dist || 1;
    const f = (d - a.dist) / span;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

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

// Build a Path from a poly-line of knots, auto-smoothing with Catmull-Rom
// tangents so the curve flows through every knot without kinks.
export function smoothPath(knots: Vec2[]): Path {
  if (knots.length < 2) {
    const p = knots[0] ?? { x: 0, y: 0 };
    return new Path([{ p0: p, p1: p, p2: p, p3: p }]);
  }
  const segs: Cubic[] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const p0 = knots[Math.max(0, i - 1)]!;
    const p1 = knots[i]!;
    const p2 = knots[i + 1]!;
    const p3 = knots[Math.min(knots.length - 1, i + 2)]!;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    segs.push({ p0: p1, p1: c1, p2: c2, p3: p2 });
  }
  return new Path(segs);
}
