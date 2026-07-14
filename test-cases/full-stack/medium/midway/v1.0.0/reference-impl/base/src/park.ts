// Midway — the park grid, connectivity graph, appeal field, pathfinding, and camera
// (specs/park.md; DESIGN.md §3.1, valence's board.ts). This module owns the plot: it
// builds the fenced plot with its gate + plaza + pond, decides what may be laid/placed
// where, floods path connectivity from the gate, accumulates scenery appeal onto the
// paths, pathfinds guests + staff over the walkable graph (BFS), and maps world<->screen
// under the camera. It holds no game state; the Game (sim.ts) owns the World and calls
// these helpers, recomputing connectivity/appeal only on an edit (not every tick).

import {
  COLS,
  ROWS,
  TILE,
  PLOT_W,
  PLOT_H,
  STAGE_W,
  PARK_Y0,
  PARK_Y1,
  ZOOM_MIN,
  ZOOM_MAX,
  SCENERY,
  TUNE,
} from "./constants";
import type { Camera, Cell, Scenery, Tile, World } from "./types";

// ---- Plot layout (DESIGN.md §3.1 — fixes overview.md "Free choices") -------------
const GATE_COL = 32;
const GATE_ROW = ROWS - 1; // the single entrance in the bottom fence
// A 3-wide paved plaza runs inward from the gate up to PLAZA_TOP, so the player can start
// laying path immediately and the camera has something to centre on.
const PLAZA_COLS = [GATE_COL - 1, GATE_COL, GATE_COL + 1];
const PLAZA_TOP = 40;
// One small pond constrains early layout (a 4x3 block near the top-left).
const POND = { col: 12, row: 10, w: 4, h: 3 };

const PARK_VIEW_H = PARK_Y1 - PARK_Y0;

// ---- Grid indexing ---------------------------------------------------------------
export function idx(col: number, row: number): number {
  return row * COLS + col;
}

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

export function tileAt(world: World, col: number, row: number): Tile | null {
  return inBounds(col, row) ? world.tiles[idx(col, row)]! : null;
}

// The world-pixel centre of a tile (movement + fx anchor on tile centres).
export function tileCenter(cell: Cell): { x: number; y: number } {
  return { x: cell.col * TILE + TILE / 2, y: cell.row * TILE + TILE / 2 };
}

export function cellOfPx(x: number, y: number): Cell {
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

// A tile guests + staff may stand/travel on: laid path or the gate (the entrance is the
// path graph's root). Grass, water, fence, and built footprints are not walkable.
function walkableKind(t: Tile): boolean {
  return t.kind === "path" || t.kind === "gate";
}

export function isWalkable(world: World, col: number, row: number): boolean {
  const t = tileAt(world, col, row);
  return !!t && walkableKind(t);
}

// ---- World construction ----------------------------------------------------------
export function makeWorld(): World {
  const tiles: Tile[] = new Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const border = col === 0 || col === COLS - 1 || row === 0 || row === ROWS - 1;
      tiles[idx(col, row)] = {
        kind: border ? "fence" : "grass",
        litter: 0,
        appeal: 0,
        connected: false,
        occupantId: -1,
        region: -1,
      };
    }
  }
  // The gate replaces one fence tile at the bottom.
  tiles[idx(GATE_COL, GATE_ROW)]!.kind = "gate";
  // The pre-laid plaza (a 3-wide stub up to PLAZA_TOP).
  for (let row = PLAZA_TOP; row < GATE_ROW; row++) {
    for (const col of PLAZA_COLS) tiles[idx(col, row)]!.kind = "path";
  }
  // The pond (decorative, non-buildable, non-pathable).
  for (let r = POND.row; r < POND.row + POND.h; r++) {
    for (let c = POND.col; c < POND.col + POND.w; c++) {
      if (inBounds(c, r)) tiles[idx(c, r)]!.kind = "water";
    }
  }

  const camera: Camera = { x: 0, y: 0, zoom: TUNE.camera.zoomDefault };
  const world: World = {
    cols: COLS,
    rows: ROWS,
    tiles,
    gate: { col: GATE_COL, row: GATE_ROW },
    plaza: PLAZA_COLS.flatMap((col) => {
      const cells: Cell[] = [];
      for (let row = PLAZA_TOP; row < GATE_ROW; row++) cells.push({ col, row });
      return cells;
    }),
    camera,
  };
  recomputeConnectivity(world);
  // Centre the camera on the gate + plaza on load (park.md).
  centerCameraOn(world, GATE_COL * TILE + TILE / 2, (PLAZA_TOP + GATE_ROW) * 0.5 * TILE);
  return world;
}

// ---- Placement legality ----------------------------------------------------------
export function canPlacePath(world: World, col: number, row: number): boolean {
  const t = tileAt(world, col, row);
  return !!t && t.kind === "grass" && t.occupantId === -1;
}

// A ride/stall/scenery footprint is legal on entirely-buildable grass inside the fence.
export function canPlaceFootprint(world: World, col: number, row: number, w: number, h: number): boolean {
  for (let r = row; r < row + h; r++) {
    for (let c = col; c < col + w; c++) {
      const t = tileAt(world, c, r);
      if (!t || t.kind !== "grass" || t.occupantId !== -1) return false;
    }
  }
  return true;
}

// ---- Connectivity (flood the walkable graph from the gate) -----------------------
// Labels every walkable tile with a connected-component region id and marks the tiles
// reachable from the gate as `connected`. Guests/staff use the region ids for O(1)
// reachability, so a severed path stub is instantly not-reachable.
export function recomputeConnectivity(world: World): void {
  for (const t of world.tiles) {
    t.connected = false;
    t.region = -1;
  }
  const gateRegionSeeds: number[] = [];
  let region = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const start = world.tiles[idx(col, row)]!;
      if (!walkableKind(start) || start.region !== -1) continue;
      // BFS-label this component.
      const queue: Cell[] = [{ col, row }];
      start.region = region;
      let touchesGate = false;
      while (queue.length) {
        const cur = queue.shift()!;
        if (cur.col === world.gate.col && cur.row === world.gate.row) touchesGate = true;
        for (const [dc, dr] of NEIGHBORS) {
          const nc = cur.col + dc;
          const nr = cur.row + dr;
          const n = tileAt(world, nc, nr);
          if (!n || !walkableKind(n) || n.region !== -1) continue;
          n.region = region;
          queue.push({ col: nc, row: nr });
        }
      }
      if (touchesGate) gateRegionSeeds.push(region);
      region++;
    }
  }
  const gateRegion = world.tiles[idx(world.gate.col, world.gate.row)]!.region;
  for (const t of world.tiles) {
    if (t.region !== -1 && (t.region === gateRegion || gateRegionSeeds.includes(t.region))) t.connected = true;
  }
}

export function gateRegion(world: World): number {
  return world.tiles[idx(world.gate.col, world.gate.row)]!.region;
}

export function regionAt(world: World, col: number, row: number): number {
  const t = tileAt(world, col, row);
  return t ? t.region : -1;
}

const NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ---- Appeal (scenery raises nearby path appeal — park.md) ------------------------
export function recomputeAppeal(world: World, scenery: Scenery[]): void {
  for (const t of world.tiles) t.appeal = 0;
  for (const s of scenery) {
    const def = SCENERY[s.kind];
    const cx = s.col + (s.w - 1) / 2;
    const cy = s.row + (s.h - 1) / 2;
    const r = def.radius;
    for (let row = Math.floor(cy - r); row <= Math.ceil(cy + r); row++) {
      for (let col = Math.floor(cx - r); col <= Math.ceil(cx + r); col++) {
        const t = tileAt(world, col, row);
        if (!t || t.kind !== "path") continue;
        const d = Math.hypot(col - cx, row - cy);
        if (d > r) continue;
        t.appeal = Math.min(1, t.appeal + def.appeal * (1 - d / r));
      }
    }
  }
}

// ---- Pathfinding (BFS over the 4-connected walkable graph) ------------------------
// The shortest path (fewest tiles) of walkable cells from `from` to `to`, inclusive of
// both endpoints, or null if `to` is unreachable. The sim memoizes results per
// from/target and invalidates on any edit.
export function findPath(world: World, from: Cell, to: Cell): Cell[] | null {
  if (!isWalkable(world, from.col, from.row) || !isWalkable(world, to.col, to.row)) return null;
  if (from.col === to.col && from.row === to.row) return [{ col: to.col, row: to.row }];
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const seen = new Uint8Array(COLS * ROWS);
  const startI = idx(from.col, from.row);
  const goalI = idx(to.col, to.row);
  seen[startI] = 1;
  const queue: number[] = [startI];
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const ci = queue[head++]!;
    if (ci === goalI) {
      found = true;
      break;
    }
    const col = ci % COLS;
    const row = (ci - col) / COLS;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const ni = idx(nc, nr);
      if (seen[ni] || !walkableKind(world.tiles[ni]!)) continue;
      seen[ni] = 1;
      prev[ni] = ci;
      queue.push(ni);
    }
  }
  if (!found) return null;
  const out: Cell[] = [];
  for (let i = goalI; i !== -1; i = prev[i]!) {
    out.push({ col: i % COLS, row: Math.floor(i / COLS) });
  }
  out.reverse();
  return out;
}

// The nearest walkable path tile to (col,row), searched on expanding rings (used to
// snap a hired staff member onto the network and to nudge a stranded guest).
export function nearestPathTile(world: World, col: number, row: number): Cell | null {
  if (isWalkable(world, col, row)) return { col, row };
  for (let r = 1; r < Math.max(COLS, ROWS); r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (isWalkable(world, nc, nr)) return { col: nc, row: nr };
      }
    }
  }
  return null;
}

// The path tile adjacent to a footprint (the entrance / queue tile); prefers a
// gate-connected one so an attraction with any connected approach reads as reachable.
export function footprintEntrance(world: World, col: number, row: number, w: number, h: number): Cell | null {
  let fallback: Cell | null = null;
  for (const cell of footprintPerimeter(col, row, w, h)) {
    const t = tileAt(world, cell.col, cell.row);
    if (!t || t.kind !== "path") continue;
    if (t.connected) return cell;
    fallback ??= cell;
  }
  return fallback;
}

function* footprintPerimeter(col: number, row: number, w: number, h: number): Generator<Cell> {
  for (let c = col; c < col + w; c++) {
    yield { col: c, row: row - 1 };
    yield { col: c, row: row + h };
  }
  for (let r = row; r < row + h; r++) {
    yield { col: col - 1, row: r };
    yield { col: col + w, row: r };
  }
}

// ---- Movement along a route (shared by guests + staff) ---------------------------
export interface Mover {
  x: number;
  y: number;
  tile: Cell;
  path: Cell[];
  pathIdx: number;
  speed: number;
  facing: 1 | -1;
}

// Advance a mover up to speed*dt px toward the next waypoint(s) of its route. Returns
// whether it reached the end of its path and how many tiles it crossed (for guest
// energy drain). Continuous — a mover never teleports between tiles.
export function advancePath(m: Mover, dt: number): { arrived: boolean; tilesCrossed: number } {
  let remaining = m.speed * dt;
  let tilesCrossed = 0;
  while (remaining > 0) {
    if (m.pathIdx >= m.path.length) return { arrived: true, tilesCrossed };
    const target = tileCenter(m.path[m.pathIdx]!);
    const dx = target.x - m.x;
    const dy = target.y - m.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.01) m.facing = dx >= 0 ? 1 : -1;
    if (dist <= remaining || dist < 0.01) {
      m.x = target.x;
      m.y = target.y;
      m.tile = m.path[m.pathIdx]!;
      m.pathIdx++;
      remaining -= dist;
      tilesCrossed++;
    } else {
      m.x += (dx / dist) * remaining;
      m.y += (dy / dist) * remaining;
      remaining = 0;
    }
  }
  return { arrived: m.pathIdx >= m.path.length, tilesCrossed };
}

// ---- Camera ----------------------------------------------------------------------
export function clampCamera(cam: Camera): void {
  cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom));
  const viewW = STAGE_W / cam.zoom;
  const viewH = PARK_VIEW_H / cam.zoom;
  cam.x = clampSpan(cam.x, PLOT_W, viewW);
  cam.y = clampSpan(cam.y, PLOT_H, viewH);
}

function clampSpan(v: number, plot: number, view: number): number {
  if (view >= plot) return (plot - view) / 2; // plot smaller than view: centre it
  return Math.max(0, Math.min(plot - view, v));
}

export function centerCameraOn(world: World, wx: number, wy: number): void {
  const cam = world.camera;
  const viewW = STAGE_W / cam.zoom;
  const viewH = PARK_VIEW_H / cam.zoom;
  cam.x = wx - viewW / 2;
  cam.y = wy - viewH / 2;
  clampCamera(cam);
}

// World px -> screen px within the park view band (y in [PARK_Y0, PARK_Y1]).
export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: PARK_Y0 + (wy - cam.y) * cam.zoom };
}

// Screen px -> world px (inverse of worldToScreen), for pointer picking.
export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.zoom, y: cam.y + (sy - PARK_Y0) / cam.zoom };
}
