// Arc Foundry — PLANNED MAZE layouts for the sim harness (the geometry lever).
//
// Arc Foundry is a GemTD reskin (specs/build.md, specs/board.md): every kept component AND every
// un-kept blocker is a 2×2 WALL, and the Load pathfinds the shortest OPEN route around the walls
// through the map's ORDERED waypoint chain. The lever a good player pulls is GEOMETRY — wall the
// yard so the shortest route is forced to DETOUR, and because the route must visit the six
// waypoints IN ORDER, the same central corridor is re-crossed on every one of the seven legs. A
// real GemTD maze folds the route many times over; a naive long snake that ignores the waypoint
// order barely reaches ~1.5×.
//
// The COMPETENT line's maze is no longer a hand-shaped comb (which folded the route only ~1.4–1.8×
// and so under-read a good player by ~4–6×). It is now a GREEDILY-GROWN maximal-fold maze, computed
// per map against the game's real A* by sim/genmaze.ts and baked into sim/planned-maze.ts: from an
// empty board, repeatedly add the single legal wall that lengthens the ordered-chain route the most
// (never sealing). That discovers the waypoint-boxing / forced-detour walls automatically and folds
// the route ~4–7× (substation ~1220t / 7.3×, switchyard ~970t / 4.1×, transformer ~680t / 4.2×) —
// the same order of magnitude as a hand-built human maze, so the "competent" ceiling is finally a
// realistic read. To re-tune or after a map/waypoint change, regenerate: `npx tsx sim/genmaze.ts`.
//
// An "anchor" is a 2×2 footprint top-left tile (col, row) on the 50×33 grid (specs/board.md §2.2).
// The harness fills these each build phase; devBlocker/devPlace snap each to the nearest legal
// anchor (Board.nearestLegalAnchor) and the sim refuses any sealing placement, so filling is safe.

import { PLANNED_MAZE } from "./planned-maze";

export interface Anchor {
  col: number;
  row: number;
}

// A tight rectangular CLUMP of 2×2 blocks packed edge-to-edge over the crossing — the "no maze"
// board. A blob does not fold the route (the Load walks past it once on a near-straight path), so
// however hard the guns hit, the Load spends little time in range. Emitted row-major.
export function clump(c0: number, r0: number, cols: number, rows: number): Anchor[] {
  const out: Anchor[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ col: c0 + c * 2, row: r0 + r * 2 });
  }
  return out;
}

// The "no maze" clumps: a dense blob straddling each map's central crossing.
const CLUMPS: Record<string, Anchor[]> = {
  substation: clump(18, 12, 7, 5),
  switchyard: clump(18, 12, 7, 5),
  transformer: clump(18, 12, 6, 5),
};

function planned(mapId: string): { firing: Anchor[]; blockers: Anchor[] } {
  return PLANNED_MAZE[mapId] ?? PLANNED_MAZE.substation!;
}

// The maze's BLOCKER anchors (the wall) and its FIRING anchors (the tower-lined hot corridor).
export function mazeFor(mapId: string): Anchor[] {
  return planned(mapId).blockers;
}
export function firingFor(mapId: string): Anchor[] {
  return planned(mapId).firing;
}
export function clumpFor(mapId: string): Anchor[] {
  return CLUMPS[mapId] ?? CLUMPS.substation!;
}
