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

// ---- The build grid (specs/board.md) ------------------------------------------
// Towers snap to a uniform square grid that tiles the board region (x in [0,1000],
// y in [56,720]) — not free pixel placement, and not a fixed set of nodes. A cell is
// buildable unless the conduit crosses it (blocked) or a tower already occupies it.
// Which lane(s) a cell actually reaches is decided purely by range against the conduit
// at runtime, so a cell beside a shared run covers both lanes because both lane
// polylines pass through the same shared world points.
export const CELL = 40; // logical px per cell edge
export const GRID_X0 = 0;
export const GRID_Y0 = 56; // STATUS_H — the board region starts below the status bar
export const COLS = 25; // 1000 / 40 → columns span x in [0, 1000]
export const ROWS = 16; // rows span y in [56, 696]
const BLOCK_DIST = 24; // a cell whose center is within this of the track is on the conduit

export interface CellInfo {
  id: number;
  col: number;
  row: number;
  cx: number; // center x
  cy: number; // center y
  blocked: boolean; // the conduit passes through this cell — no tower may occupy it
  laneDist: number; // distance from the cell center to the nearest lane centerline
}

// Shortest distance from point p to segment a-b.
function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  const qx = a.x + dx * t;
  const qy = a.y + dy * t;
  return Math.hypot(px - qx, py - qy);
}

// Distance from a point to the nearest lane centerline (either lane's polyline).
function distToConduit(px: number, py: number): number {
  let best = Infinity;
  for (const poly of LANE_POLY) {
    for (let i = 1; i < poly.length; i++) {
      const d = distToSegment(px, py, poly[i - 1]!, poly[i]!);
      if (d < best) best = d;
    }
  }
  return best;
}

// Every cell of the grid, precomputed once. `blocked` marks the cells the conduit
// crosses (the tracks, inlet, splitter, confluence, and collector all lie on a lane
// polyline, so distance-to-conduit covers them).
export const CELLS: CellInfo[] = (() => {
  const out: CellInfo[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = GRID_X0 + col * CELL + CELL / 2;
      const cy = GRID_Y0 + row * CELL + CELL / 2;
      const laneDist = distToConduit(cx, cy);
      out.push({ id: row * COLS + col, col, row, cx, cy, blocked: laneDist < BLOCK_DIST, laneDist });
    }
  }
  return out;
})();

// The cell id containing world point (x, y), or null if it falls outside the grid.
export function cellIdAt(x: number, y: number): number | null {
  const col = Math.floor((x - GRID_X0) / CELL);
  const row = Math.floor((y - GRID_Y0) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return row * COLS + col;
}

export function cellCenter(id: number): Pt {
  const c = CELLS[id]!;
  return { x: c.cx, y: c.cy };
}

// A cell is blocked when the conduit crosses it; blocked cells can never hold a tower.
export function isBlocked(id: number): boolean {
  const c = CELLS[id];
  return !c || c.blocked;
}
