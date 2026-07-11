// Meltdown — declarative maze layouts for the sim harness. Coordinates are
// footprint top-left tiles on the 50x36 grid (specs/playfield.md):
//   Left vent  rows 16..19 (col 0)  -> Right exhaust rows 16..19 (col 49)
//   Top vent   cols 22..29 (row 0)  -> Bottom exhaust cols 22..29 (row 35)
// The two streams cross in the centre block (cols 22..29 x rows 16..19).

import type { Rotation, TowerType } from "../src/types";
import type { BuildOrder } from "./harness";

interface WallOpts {
  type?: TowerType; // emitter for the wall cells (default arc)
  rot?: Rotation; // rotation for every wall cell
  sinkEvery?: number; // replace every Nth cell with a Sink (0 = none)
  level?: number; // upgrade target for the emitter cells
  minWave?: number;
}

// A vertical wall of 2x2 blocks stacked from row r0 down to (and including a
// block ending at) r1, at column `col`. Blocks touch on their N/S faces.
export function vWall(col: number, r0: number, r1: number, opts: WallOpts = {}): BuildOrder[] {
  const out: BuildOrder[] = [];
  let k = 0;
  for (let r = r0; r + 1 <= r1; r += 2, k++) {
    const isSink = opts.sinkEvery && k > 0 && k % opts.sinkEvery === 0;
    out.push({
      type: isSink ? "sink" : opts.type ?? "arc",
      col,
      row: r,
      rot: isSink ? 0 : opts.rot ?? 0,
      level: isSink ? undefined : opts.level,
      minWave: opts.minWave,
    });
  }
  return out;
}

// A horizontal wall of 2x2 blocks from col c0 to c1 at row `row`.
export function hWall(row: number, c0: number, c1: number, opts: WallOpts = {}): BuildOrder[] {
  const out: BuildOrder[] = [];
  let k = 0;
  for (let c = c0; c + 1 <= c1; c += 2, k++) {
    const isSink = opts.sinkEvery && k > 0 && k % opts.sinkEvery === 0;
    out.push({
      type: isSink ? "sink" : opts.type ?? "arc",
      col: c,
      row,
      rot: isSink ? 0 : opts.rot ?? 0,
      level: isSink ? undefined : opts.level,
      minWave: opts.minWave,
    });
  }
  return out;
}

// ---- BOUSTROPHEDON: a fed maze -------------------------------------------
// Horizontal walls (rows of 2x2 guns) across the floor with alternating end
// gaps, so the surge snakes up/down through 2-tile corridors. Because every wall
// gun sits point-blank against a corridor the surge threads, the guns are fed
// continuously and heat toward their plateau — this is the maze that actually
// uses the heat system. `sinkEvery` threads Sinks; `rot` aims radiators at the
// corridor (walls run E-W, so their open faces are N/S -> rot 0 keeps Arc N/S
// radiators on the corridor).
export function boustrophedonLayout(opts: { sinkEvery: number; level?: number; rot?: Rotation }): BuildOrder[] {
  const rows = [4, 8, 12, 16, 20, 24, 28];
  const out: BuildOrder[] = [];
  let placed = 0;
  rows.forEach((row, i) => {
    // Alternate the connecting gap: even walls open on the right, odd on the left.
    const gapRight = i % 2 === 0;
    const c0 = gapRight ? 2 : 8;
    const c1 = gapRight ? 42 : 48;
    for (let c = c0; c + 1 <= c1; c += 2) {
      const isSink = opts.sinkEvery > 0 && placed > 0 && placed % opts.sinkEvery === 0;
      out.push({
        type: isSink ? "sink" : "arc",
        col: c,
        row,
        rot: isSink ? 0 : opts.rot ?? 0,
        level: isSink ? undefined : opts.level,
      });
      placed++;
    }
  });
  return out;
}

// ---- FLANK: the "no maze" defence ----------------------------------------
// Guns line both sides of each straight lane but never block it, so the surge
// walks straight across (shortest path unchanged). This is what a player who
// refuses to maze would build; it should not be enough.
export function flankLayout(): BuildOrder[] {
  const o: BuildOrder[] = [];
  // L->R lane is rows 16..19; flank just above (row 14 => tiles 14-15) and just
  // below (row 20 => tiles 20-21), all the way across. Arc radiators are N/S,
  // which face straight into the lane here — good coverage, open cooling.
  for (let c = 2; c <= 46; c += 3) {
    o.push({ type: "arc", col: c, row: 14, rot: 0 });
    o.push({ type: "arc", col: c, row: 20, rot: 0 });
  }
  // T->B lane is cols 22..29; flank left (col 20) and right (col 30) down its
  // length, rotated so N/S radiators point along... rotate 90 so radiators face
  // the lane (E/W).
  for (let r = 2; r <= 32; r += 3) {
    o.push({ type: "arc", col: 20, row: r, rot: 1 });
    o.push({ type: "arc", col: 30, row: r, rot: 1 });
  }
  return o;
}

// The shared 5-tooth vertical serpentine. Teeth alternate a gap at the bottom
// and the top, forcing the L->R stream into a long up/down weave; their guns
// also range over the T->B stream as it descends the centre. Cells are emitted
// ROUND-ROBIN across the five teeth so a partial (early-game) build spreads
// coverage across the whole width rather than finishing one tooth at a time.
const TEETH: Array<{ col: number; r0: number; r1: number }> = [
  { col: 8, r0: 0, r1: 27 }, // gap bottom (rows 28..35)
  { col: 16, r0: 8, r1: 35 }, // gap top (rows 0..7)
  { col: 24, r0: 0, r1: 27 },
  { col: 32, r0: 8, r1: 35 },
  { col: 40, r0: 0, r1: 27 },
];

export interface CombOpts {
  rot: Rotation; // rotation for the emitter cells (radiator aim)
  sinkEvery: number; // replace every Nth placed cell with a Sink (0 = none)
  level?: number; // upgrade target for the emitter cells
}

export function combCells(opts: CombOpts): BuildOrder[] {
  const cols = TEETH.map((t) => {
    const cells: Array<{ col: number; row: number }> = [];
    for (let r = t.r0; r + 1 <= t.r1; r += 2) cells.push({ col: t.col, row: r });
    return cells;
  });
  const maxLen = Math.max(...cols.map((c) => c.length));
  const out: BuildOrder[] = [];
  let placed = 0;
  for (let i = 0; i < maxLen; i++) {
    for (const c of cols) {
      if (i >= c.length) continue;
      const isSink = opts.sinkEvery > 0 && placed > 0 && placed % opts.sinkEvery === 0;
      out.push({
        type: isSink ? "sink" : "arc",
        col: c[i].col,
        row: c[i].row,
        rot: isSink ? 0 : opts.rot,
        level: isSink ? undefined : opts.level,
      });
      placed++;
    }
  }
  return out;
}

// A TIGHT vertical serpentine: teeth every 4 columns (2-wide teeth, 2-wide
// corridors) so the surge snake threads close past every gun and keeps it fed —
// the fed version of the comb, where guns actually reach their plateau.
export function tightCombCells(opts: CombOpts & { c0?: number; c1?: number }): BuildOrder[] {
  const c0 = opts.c0 ?? 6;
  const c1 = opts.c1 ?? 42;
  const cols: Array<{ col: number; r0: number; r1: number }> = [];
  let i = 0;
  for (let c = c0; c <= c1; c += 4, i++) {
    if (i % 2 === 0) cols.push({ col: c, r0: 0, r1: 27 }); // gap bottom
    else cols.push({ col: c, r0: 8, r1: 35 }); // gap top
  }
  const cellLists = cols.map((t) => {
    const cells: Array<{ col: number; row: number }> = [];
    for (let r = t.r0; r + 1 <= t.r1; r += 2) cells.push({ col: t.col, row: r });
    return cells;
  });
  const maxLen = Math.max(...cellLists.map((c) => c.length));
  const out: BuildOrder[] = [];
  let placed = 0;
  for (let k = 0; k < maxLen; k++) {
    for (const cells of cellLists) {
      if (k >= cells.length) continue;
      const isSink = opts.sinkEvery > 0 && placed > 0 && placed % opts.sinkEvery === 0;
      out.push({
        type: isSink ? "sink" : "arc",
        col: cells[k].col,
        row: cells[k].row,
        rot: isSink ? 0 : opts.rot,
        level: isSink ? undefined : opts.level,
      });
      placed++;
    }
  }
  return out;
}

// ---- SERP_SOLID: a real maze, but heat ignored ---------------------------
// Solid Arc walls at default rotation (radiators N/S). In a vertical wall the
// N/S faces touch neighbors, so the radiators are blanketed and interior guns
// bake to the trip — the "mazed but ignored the heat" defence.
export function serpSolidLayout(): BuildOrder[] {
  return combCells({ rot: 0, sinkEvery: 0 });
}

// ---- SERP_MANAGED: maze + heat management --------------------------------
// The same serpentine geometry, but each wall cell is rotated 90 so its N/S
// radiators point E/W into the open lanes, and Sinks are threaded through the
// walls to cool the interior cells. Competent play: a maze that also paces heat.
export function serpManagedLayout(): BuildOrder[] {
  return combCells({ rot: 1, sinkEvery: 7 });
}
