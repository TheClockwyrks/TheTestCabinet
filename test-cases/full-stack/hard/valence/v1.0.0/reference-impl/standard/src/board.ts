// Valence — the board geometry (specs/board.md).
//
// One fixed conduit: a shared inlet approach, a fork into two lanes (A over the top,
// B under the bottom), a confluence, and a shared final run to the collector. Each
// lane is stored as a full polyline from the inlet (progress 0) to the collector
// (progress = laneLength), so a unit's progress `s` is arc length toward the
// collector and "furthest along" targeting is simply the largest `s`. The two lanes
// are symmetric, so both have equal length and neither is favoured.

export type Lane = 0 | 1; // 0 = Lane A (top), 1 = Lane B (bottom)

export interface Pt {
  x: number;
  y: number;
}

// The two lane polylines. The first two points (inlet → splitter) and the last two
// (confluence → collector) are the SHARED runs — identical world coordinates in both
// lanes — so a tower placed beside them reaches every unit regardless of lane.
const SPLITTER: Pt = { x: 150, y: 400 };
const CONFLUENCE: Pt = { x: 820, y: 400 };
const INLET: Pt = { x: 24, y: 400 };
const COLLECTOR: Pt = { x: 958, y: 400 };

const LANE_POLY: Pt[][] = [
  // Lane A — over the top.
  [INLET, SPLITTER, { x: 150, y: 185 }, { x: 820, y: 185 }, CONFLUENCE, COLLECTOR],
  // Lane B — under the bottom.
  [INLET, SPLITTER, { x: 150, y: 615 }, { x: 820, y: 615 }, CONFLUENCE, COLLECTOR],
];

export const INLET_POS = INLET;
export const COLLECTOR_POS = COLLECTOR;
export const SPLITTER_POS = SPLITTER;
export const CONFLUENCE_POS = CONFLUENCE;

// Cumulative arc length at each vertex, per lane.
const CUM: number[][] = LANE_POLY.map((poly) => {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
});

export function laneLength(lane: Lane): number {
  const cum = CUM[lane]!;
  return cum[cum.length - 1]!;
}

export interface SamplePt extends Pt {
  ang: number; // tangent angle (radians), direction of travel toward the collector
}

// The point at arc length `s` along `lane`, with the local tangent angle. `s` is
// clamped to the lane's length.
export function sampleLane(lane: Lane, s: number): SamplePt {
  const poly = LANE_POLY[lane]!;
  const cum = CUM[lane]!;
  const total = cum[cum.length - 1]!;
  const t = Math.max(0, Math.min(total, s));
  let seg = 1;
  while (seg < cum.length - 1 && cum[seg]! < t) seg++;
  const a = poly[seg - 1]!;
  const b = poly[seg]!;
  const segLen = cum[seg]! - cum[seg - 1]!;
  const f = segLen > 0 ? (t - cum[seg - 1]!) / segLen : 0;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    ang: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

// A dense list of {point, angle} samples along a lane, for laying the produced
// conduit sprites (render only). Shared runs appear in both lanes (harmless overlap).
export function laneSamples(lane: Lane, stepPx: number): SamplePt[] {
  const total = laneLength(lane);
  const out: SamplePt[] = [];
  for (let s = 0; s <= total; s += stepPx) out.push(sampleLane(lane, s));
  return out;
}

// ---- Emitter nodes (specs/board.md) -------------------------------------------
// 16 fixed nodes: 4 beside the shared runs (premium — reach both lanes), 6 beside
// Lane A, 6 beside Lane B. Which lane(s) a node actually reaches is decided purely
// by range against the conduit at runtime, so shared nodes cover both lanes because
// both lane polylines pass through the same shared world points.
export interface NodeDef {
  id: number;
  x: number;
  y: number;
}

export const NODES: NodeDef[] = [
  // Shared — inlet approach.
  { id: 0, x: 88, y: 352 },
  { id: 1, x: 88, y: 448 },
  // Shared — final run.
  { id: 2, x: 892, y: 352 },
  { id: 3, x: 892, y: 448 },
  // Lane A (top).
  { id: 4, x: 214, y: 300 },
  { id: 5, x: 214, y: 224 },
  { id: 6, x: 320, y: 128 },
  { id: 7, x: 485, y: 128 },
  { id: 8, x: 650, y: 128 },
  { id: 9, x: 756, y: 268 },
  // Lane B (bottom).
  { id: 10, x: 214, y: 500 },
  { id: 11, x: 214, y: 576 },
  { id: 12, x: 320, y: 672 },
  { id: 13, x: 485, y: 672 },
  { id: 14, x: 650, y: 672 },
  { id: 15, x: 756, y: 532 },
];
