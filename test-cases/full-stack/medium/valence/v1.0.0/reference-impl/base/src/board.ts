// Valence — maps, paths, and free tower placement (specs/board.md).
//
// The campaign is played on a MAP the player chooses at the map-select screen. A map lays
// one or more PATHS over the board region; the maps differ in topology (a single path, a
// branching fork of lanes, or several fully separate tracks) and in path style (smooth
// CURVES vs straight lines with RIGHT-ANGLE corners). Each path is stored as a dense
// polyline from its inlet (progress 0) to its collector (progress = length), so a unit's
// progress `s` is arc length toward the collector and "furthest along" targeting is simply
// the largest `s`. A branching map is two paths that COINCIDE on a shared trunk/final run
// and diverge between them, so a tower beside a shared stretch covers both lanes; a
// multiple-separate-paths map shares nothing, so every front costs its own towers.
//
// Towers are placed FREELY (Bloons-style) at arbitrary board positions — not on a grid.
// A placement is legal when its footprint stays in bounds, sits off every path, and does
// not overlap another tower (canPlaceAt / nearestLegal below).

import { BOARD_X0, BOARD_X1, BOARD_Y0, BOARD_Y1 } from "./constants";

export type Lane = number; // index into the active map's paths (was the fixed 0|1 lane)

export interface Pt {
  x: number;
  y: number;
}

export interface SamplePt extends Pt {
  ang: number; // tangent angle (radians), direction of travel toward the collector
}

export type PathStyle = "curved" | "straight";

export interface PathDef {
  style: PathStyle;
  points: Pt[]; // control/vertex points from inlet to collector
}

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export interface GameMap {
  id: string;
  name: string;
  difficulty: Difficulty;
  topology: string; // "SINGLE PATH" | "BRANCHING" | "MULTIPLE PATHS"
  styleLabel: string; // "CURVED" | "STRAIGHT"
  blurb: string;
  paths: PathDef[];
}

// ---- Free-placement footprint (specs/board.md) --------------------------------
export const TOWER_FOOTPRINT = 15; // a tower occupies this radius where it is dropped
const MIN_PATH_DIST = TOWER_FOOTPRINT + 12; // center-to-path-centerline clearance (off the track)
const MIN_TOWER_GAP = 2 * TOWER_FOOTPRINT; // two footprints may not overlap

// ---- Geometry helpers ---------------------------------------------------------
function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Shortest distance from point (px,py) to segment a-b.
function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  const qx = a.x + dx * t;
  const qy = a.y + dy * t;
  return Math.hypot(px - qx, py - qy);
}

// Sample a Catmull-Rom spline through `pts` into a dense polyline (curved paths). Endpoints
// are duplicated so the curve passes through the first and last control point.
function catmullRomPoly(pts: Pt[], step: number): Pt[] {
  if (pts.length < 3) return densify(pts, step);
  const p = [pts[0]!, ...pts, pts[pts.length - 1]!];
  const out: Pt[] = [{ ...pts[0]! }];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2]!;
    const segLen = dist(p1, p2);
    const subs = Math.max(2, Math.ceil(segLen / step));
    for (let j = 1; j <= subs; j++) {
      const t = j / subs;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  return out;
}

// Densify a straight polyline (right-angle paths keep their exact corners; we just add
// in-between samples so laying the produced track sprites and the flow read stay even).
function densify(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const segLen = dist(a, b);
    const subs = Math.max(1, Math.ceil(segLen / step));
    for (let j = 1; j <= subs; j++) {
      const t = j / subs;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const PATH_STEP = 6; // dense-polyline resolution (logical px)

// A single path: a dense polyline from inlet to collector with cumulative arc length.
export class Path {
  readonly poly: Pt[];
  readonly cum: number[];
  readonly length: number;
  readonly style: PathStyle;

  constructor(def: PathDef) {
    this.style = def.style;
    this.poly = def.style === "curved" ? catmullRomPoly(def.points, PATH_STEP) : densify(def.points, PATH_STEP);
    const cum = [0];
    for (let i = 1; i < this.poly.length; i++) cum.push(cum[i - 1]! + dist(this.poly[i - 1]!, this.poly[i]!));
    this.cum = cum;
    this.length = cum[cum.length - 1]!;
  }

  get inlet(): Pt {
    return this.poly[0]!;
  }
  get collector(): Pt {
    return this.poly[this.poly.length - 1]!;
  }

  // The point at arc length `s`, with the local tangent angle. `s` is clamped to length.
  sample(s: number): SamplePt {
    const t = Math.max(0, Math.min(this.length, s));
    let seg = 1;
    while (seg < this.cum.length - 1 && this.cum[seg]! < t) seg++;
    const a = this.poly[seg - 1]!;
    const b = this.poly[seg]!;
    const segLen = this.cum[seg]! - this.cum[seg - 1]!;
    const f = segLen > 0 ? (t - this.cum[seg - 1]!) / segLen : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  distTo(px: number, py: number): number {
    let best = Infinity;
    for (let i = 1; i < this.poly.length; i++) {
      const d = distToSegment(px, py, this.poly[i - 1]!, this.poly[i]!);
      if (d < best) best = d;
    }
    return best;
  }
}

// The live board: the paths of the chosen map plus the free-placement rules over them.
export class Board {
  readonly map: GameMap;
  readonly paths: Path[];

  constructor(map: GameMap) {
    this.map = map;
    this.paths = map.paths.map((d) => new Path(d));
  }

  get pathCount(): number {
    return this.paths.length;
  }
  pathLength(i: Lane): number {
    return this.paths[i]!.length;
  }
  sample(i: Lane, s: number): SamplePt {
    return this.paths[i]!.sample(s);
  }
  // Dense {point, angle} samples along a path, for laying the produced track sprites.
  pathSamples(i: Lane, stepPx: number): SamplePt[] {
    const total = this.pathLength(i);
    const out: SamplePt[] = [];
    for (let s = 0; s <= total; s += stepPx) out.push(this.sample(i, s));
    return out;
  }
  // Distance from a point to the nearest path centerline (any path).
  distToPaths(x: number, y: number): number {
    let best = Infinity;
    for (const p of this.paths) {
      const d = p.distTo(x, y);
      if (d < best) best = d;
    }
    return best;
  }

  // Why a tower footprint may NOT be placed at (x, y), or null if the spot is legal. Checked
  // in the specs/board.md order — in bounds, off every path, not overlapping another tower —
  // so a caller (the debug API's placeTower) can report the exact refusal reason.
  placementReason(x: number, y: number, towers: { id: number; x: number; y: number }[], ignoreId?: number): "bounds" | "path" | "overlap" | null {
    const f = TOWER_FOOTPRINT;
    if (x < BOARD_X0 + f || x > BOARD_X1 - f || y < BOARD_Y0 + f || y > BOARD_Y1 - f) return "bounds";
    if (this.distToPaths(x, y) < MIN_PATH_DIST) return "path";
    for (const t of towers) {
      if (t.id === ignoreId) continue;
      if (Math.hypot(t.x - x, t.y - y) < MIN_TOWER_GAP) return "overlap";
    }
    return null;
  }

  // Is (x, y) a legal spot for a tower footprint? In bounds, off every path, and not
  // overlapping another tower (ignore the tower with id `ignoreId`, when re-checking).
  canPlaceAt(x: number, y: number, towers: { id: number; x: number; y: number }[], ignoreId?: number): boolean {
    return this.placementReason(x, y, towers, ignoreId) === null;
  }

  // The nearest legal placement to (x, y), searched on expanding rings. Used by the
  // headless balance harness, whose declarative layouts name approximate world anchors
  // (the browser places exactly at the pointer instead).
  nearestLegal(x: number, y: number, towers: { id: number; x: number; y: number }[]): Pt | null {
    if (this.canPlaceAt(x, y, towers)) return { x, y };
    for (let r = 8; r <= 200; r += 8) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 8));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (this.canPlaceAt(px, py, towers)) return { x: px, y: py };
      }
    }
    return null;
  }
}

// ---- The map catalog (specs/board.md) -----------------------------------------
// Three maps, one per difficulty, spanning both path styles: an EASY curved single path,
// a MEDIUM straight/right-angle branching fork (two lanes sharing an inlet trunk and a
// final run), and a HARD trio of fully separate curved tracks. Every map plays the same
// 20-round campaign — the topology is the difficulty, not the numbers (specs/board.md).

// EASY — CONDUIT: one winding curved path sweeping across three horizontal lanes.
const CONDUIT: GameMap = {
  id: "conduit",
  name: "CONDUIT",
  difficulty: "EASY",
  topology: "SINGLE PATH",
  styleLabel: "CURVED",
  blurb: "One winding channel. Blanket it and strip everything before the collector.",
  paths: [
    {
      style: "curved",
      points: [
        { x: 24, y: 170 },
        { x: 820, y: 170 },
        { x: 930, y: 290 },
        { x: 820, y: 410 },
        { x: 150, y: 410 },
        { x: 60, y: 540 },
        { x: 170, y: 640 },
        { x: 976, y: 640 },
      ],
    },
  ],
};

// MEDIUM — JUNCTION: a straight/right-angle fork. Both lanes share the inlet trunk and the
// final run (identical world points there), so a tower beside a shared stretch covers both.
const J_IN: Pt = { x: 24, y: 388 };
const J_SPLIT: Pt = { x: 150, y: 388 };
const J_MERGE: Pt = { x: 820, y: 388 };
const J_OUT: Pt = { x: 976, y: 388 };
const JUNCTION: GameMap = {
  id: "junction",
  name: "JUNCTION",
  difficulty: "MEDIUM",
  topology: "BRANCHING",
  styleLabel: "STRAIGHT",
  blurb: "A fork into two lanes that rejoin. Split your coverage — or hold the shared runs.",
  paths: [
    { style: "straight", points: [J_IN, J_SPLIT, { x: 150, y: 150 }, { x: 820, y: 150 }, J_MERGE, J_OUT] },
    { style: "straight", points: [J_IN, J_SPLIT, { x: 150, y: 626 }, { x: 820, y: 626 }, J_MERGE, J_OUT] },
  ],
};

// HARD — LATTICE: three fully separate curved tracks in their own horizontal bands (they
// never share a lane), each with its own inlet and collector. No stretch is shared, so
// every front demands its own towers.
const LATTICE: GameMap = {
  id: "lattice",
  name: "LATTICE",
  difficulty: "HARD",
  topology: "MULTIPLE PATHS",
  styleLabel: "CURVED",
  blurb: "Three separate channels, three fronts. One board's towers must cover them all.",
  paths: [
    {
      style: "curved",
      points: [
        { x: 24, y: 150 },
        { x: 250, y: 118 },
        { x: 480, y: 205 },
        { x: 720, y: 118 },
        { x: 976, y: 168 },
      ],
    },
    {
      style: "curved",
      points: [
        { x: 24, y: 400 },
        { x: 262, y: 452 },
        { x: 500, y: 360 },
        { x: 760, y: 452 },
        { x: 976, y: 392 },
      ],
    },
    {
      style: "curved",
      points: [
        { x: 24, y: 600 },
        { x: 250, y: 652 },
        { x: 520, y: 568 },
        { x: 780, y: 660 },
        { x: 976, y: 610 },
      ],
    },
  ],
};

export const MAPS: GameMap[] = [CONDUIT, JUNCTION, LATTICE];
export const DEFAULT_MAP = CONDUIT;

export function mapById(id: string): GameMap {
  return MAPS.find((m) => m.id === id) ?? DEFAULT_MAP;
}
