// Arc Foundry — declarative PLANNED MAZE layouts for the sim harness.
//
// Arc Foundry is a GemTD reskin (specs/build.md, specs/board.md): every kept component AND
// every un-kept blocker is a 2×2 WALL, and the Load pathfinds the shortest OPEN route around
// the walls through the map's ORDERED waypoint chain. The lever a good player pulls is
// GEOMETRY — build your walls as a serpentine that folds the route back and forth so the Load
// crawls a long path, and line the corridors of that serpentine with your firing COMPONENTS so
// the Load is under fire the whole crawl (never sealing a waypoint segment — a sealing
// placement is refused).
//
// The maze is TOWER-LINED and grows CENTER-OUT. Each map now runs SIX waypoints, so its route
// already sweeps the whole yard; the maze is a comb of full-height vertical TEETH built outward
// from the middle that folds that route into a deep serpentine: the central tooth (a firing
// wall) rises first — a tight early choke that a 1–4 tower opening can hold — and each further
// tooth widens the weave across the middle band so the Load cannot slip through. Within a tooth
// the cells nearest the crossing are FIRING slots (kept
// components that cover the two corridors the Load weaves through on either side); the rest are
// BLOCKERS that raise the wall. So the firing line spreads only as fast as the maze that carries
// it, and coverage stays concentrated where the Load is — coverage a central clump cannot fold up.
//
// An "anchor" is a 2×2 footprint top-left tile (col, row) on the 50×33 grid (specs/board.md
// §2.2). A controller builds TOWARD these anchors in order; the exact tile is not load-bearing
// — the harness snaps each to the nearest legal anchor (Board.nearestLegalAnchor) and the sim
// refuses any sealing placement, so an aggressive comb is safe.

export interface Anchor {
  col: number;
  row: number;
}

// The board's central row. Each map now runs SIX waypoints spread across cols 5..44 / rows
// 5..28, so the inherent route already sweeps the whole yard; a FULL-HEIGHT comb centred here
// folds that route into a deep serpentine regardless of which leg happens to funnel. CROSS_ROW
// only decides which cells of a tooth are FIRING slots (nearest the middle, best corridor
// coverage) vs raise-the-wall BLOCKERS — the wall SHAPE is the same either way.
const CROSS_ROW = 16;

// A vertical "tooth": a stack of 2×2 blocks at column `col`, from row r0 down to a block
// ending at r1 (blocks touch on their N/S faces). Anchors step by 2 rows.
function tooth(col: number, r0: number, r1: number): Anchor[] {
  const out: Anchor[] = [];
  for (let r = r0; r + 1 <= r1; r += 2) out.push({ col, row: r });
  return out;
}

// A tower-lined comb grown CENTER-OUT. Teeth march outward from `cCtr` (cCtr, cCtr∓step,
// cCtr±step, …) across `nEachSide` on each side; each spans the full height save an
// alternating `gap` (even teeth gap at the bottom, odd at the top) that forces the up/down
// serpentine. Every tooth's cells split into FIRING (the `firePerTooth` cells nearest the
// crossing row — corridor coverage) and BLOCKERS (the rest, filling the wall from the middle
// out). Both lists are emitted tooth-by-tooth from the centre, so a partial early build raises
// the central firing tooth first.
function towerLinedComb(
  cCtr: number,
  step: number,
  nEachSide: number,
  rTop: number,
  rBot: number,
  gap: number,
  firePerTooth: number,
): { firing: Anchor[]; blockers: Anchor[] } {
  const cols: number[] = [cCtr];
  for (let k = 1; k <= nEachSide; k++) {
    cols.push(cCtr - k * step);
    cols.push(cCtr + k * step);
  }
  const firing: Anchor[] = [];
  const blockers: Anchor[] = [];
  cols.forEach((col, i) => {
    const cells = i % 2 === 0 ? tooth(col, rTop, rBot - gap) : tooth(col, rTop + gap, rBot);
    cells.sort((a, b) => Math.abs(a.row - CROSS_ROW) - Math.abs(b.row - CROSS_ROW));
    cells.forEach((cell, j) => (j < firePerTooth ? firing : blockers).push(cell));
  });
  return { firing, blockers };
}

// A tight rectangular CLUMP of 2×2 blocks packed edge-to-edge over the crossing — the "no
// maze" board. A blob does not fold the route (the Load walks past it once on a near-straight
// path), so however hard the guns hit, the Load spends little time in range. Emitted row-major.
export function clump(c0: number, r0: number, cols: number, rows: number): Anchor[] {
  const out: Anchor[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ col: c0 + c * 2, row: r0 + r * 2 });
  }
  return out;
}

// ---- The three maps' planned boards (specs/board.md §4) -------------------------
// A tower-lined comb centred on col 24, full height (rows 0..31), teeth every 4 columns
// (nEachSide 4 → cols 8..40) with an 8-row alternating gap (top on odd teeth, bottom on even)
// that forces the up/down serpentine, spanning the width so the Load cannot route around it.
// Verified against the SIX-waypoint maps: this folds every map's route to ~1.4× the bare-board
// route (substation ×1.45, switchyard ×1.39, transformer ×1.43) while leaving the early central
// choke loose enough that a competent opening survives Wave 1–5 (a tighter gap / wider span
// spreads the sparse early firing line too thin and it leaks out before it can climb). The
// housings + waypoint platforms are auto-avoided by nearestLegalAnchor's snap; Transformer keeps
// a slightly deeper gap (9) so its teeth thread cleanly past the two fixed housings.
const COMBS: Record<string, { firing: Anchor[]; blockers: Anchor[] }> = {
  substation: towerLinedComb(24, 4, 4, 0, 31, 8, 3),
  switchyard: towerLinedComb(24, 4, 4, 0, 31, 8, 3),
  transformer: towerLinedComb(24, 4, 4, 0, 31, 9, 3),
};

// The "no maze" clumps: a dense blob straddling each map's central crossing.
const CLUMPS: Record<string, Anchor[]> = {
  substation: clump(18, 12, 7, 5),
  switchyard: clump(18, 12, 7, 5),
  transformer: clump(18, 12, 6, 5),
};

// The maze's BLOCKER anchors (the wall) and its FIRING anchors (the tower-lined corridors).
export function mazeFor(mapId: string): Anchor[] {
  return (COMBS[mapId] ?? COMBS.substation!).blockers;
}
export function firingFor(mapId: string): Anchor[] {
  return (COMBS[mapId] ?? COMBS.substation!).firing;
}
export function clumpFor(mapId: string): Anchor[] {
  return CLUMPS[mapId] ?? CLUMPS.substation!;
}
