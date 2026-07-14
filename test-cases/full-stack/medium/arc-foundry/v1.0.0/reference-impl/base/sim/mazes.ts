// Arc Foundry — declarative PLANNED MAZE layouts for the sim harness.
//
// Arc Foundry is a GemTD reskin (specs/build.md, specs/board.md): every stamped
// component is ALSO a 2×2 maze wall, and the Load pathfinds the shortest OPEN route
// around the walls through the map's ORDERED waypoint chain. So the single biggest
// lever a competent player pulls is GEOMETRY — you place your firing line as a
// serpentine that folds the shortest route back and forth so the Load crawls a long
// path past your components (more time in range = more damage), while never fully
// sealing a waypoint segment (the never-seal rule refuses that placement).
//
// An "anchor" here is a 2×2 footprint top-left tile (col, row) on the 50×33 grid
// (specs/board.md §2.2). A controller builds TOWARD these anchors in order; the exact
// tile is not load-bearing — the harness snaps each to the nearest legal anchor
// (Board.nearestLegalAnchor), and the sim refuses any placement that would seal, so
// an aggressive comb is safe. Anchors are emitted ROUND-ROBIN across the teeth so a
// partial (early-game) build spreads coverage across the whole maze rather than
// finishing one tooth at a time (mirrors Meltdown's combCells).

export interface Anchor {
  col: number;
  row: number;
}

// A vertical "tooth": a stack of 2×2 blocks at column `col`, from row r0 down to a
// block ending at r1 (blocks touch on their N/S faces). Anchors step by 2 rows.
function tooth(col: number, r0: number, r1: number): Anchor[] {
  const out: Anchor[] = [];
  for (let r = r0; r + 1 <= r1; r += 2) out.push({ col, row: r });
  return out;
}

// A vertical-teeth COMB across [c0, c1] at column step `step`, spanning rows
// [rTop, rBot]. Even teeth leave a gap at the BOTTOM (stop `gap` rows short of rBot);
// odd teeth leave a gap at the TOP (start `gap` rows below rTop). That alternation is
// what forces the shortest route into a long up/down serpentine between the teeth.
//
// CRITICAL: the teeth must span nearly the FULL board height (rTop≈0, rBot≈31), leaving
// only the alternating corridor gap — otherwise the Load simply routes AROUND the comb
// through the open border rows (the maps' waypoints sit on the perimeter), and the maze
// adds almost nothing. This mirrors Meltdown's full-height TEETH.
// The teeth are interleaved round-robin so an incomplete build still spans the width.
function comb(c0: number, c1: number, step: number, rTop: number, rBot: number, gap: number): Anchor[] {
  const teeth: Anchor[][] = [];
  let i = 0;
  for (let c = c0; c <= c1; c += step, i++) {
    if (i % 2 === 0) teeth.push(tooth(c, rTop, rBot - gap)); // gap at bottom
    else teeth.push(tooth(c, rTop + gap, rBot)); // gap at top
  }
  const maxLen = Math.max(...teeth.map((t) => t.length));
  const out: Anchor[] = [];
  for (let k = 0; k < maxLen; k++) {
    for (const t of teeth) if (k < t.length) out.push(t[k]!);
  }
  return out;
}

// A tight rectangular CLUMP of 2×2 blocks packed edge-to-edge over
// [c0..c1] × [r0..r1] — the "no-maze" board. A blob does not fold the route (the Load
// walks around it on a near-straight path), so however hard the guns hit, the Load
// spends little time in range. Emitted row-major (dense).
export function clump(c0: number, r0: number, cols: number, rows: number): Anchor[] {
  const out: Anchor[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ col: c0 + c * 2, row: r0 + r * 2 });
  }
  return out;
}

// ---- The three maps' planned mazes (specs/board.md §4) --------------------------
// Each is a central serpentine comb sized to the map's open interior. The exact
// coordinates only need to be roughly right — nearest-legal snapping + never-seal do
// the rest — but they are placed to fold the map's long waypoint legs:
//   • Substation: the final leg (WP4→Collector) runs the full width at row ~16, and
//     the opening leg (Entry→WP1) runs the full width at row ~4; a central vertical
//     comb folds both.
//   • Switchyard: the star's legs criss-cross the centre band; a central comb makes
//     the premium middle a long weave.
//   • Transformer: two fixed housings already pinch the yard; the comb thickens the
//     centre threads the middle waypoint forces (housings are auto-avoided by snap).
// Full-height combs (rTop 0 → rBot 31) with an 8-row alternating corridor gap, teeth
// every 4 columns (2-wide tooth, 2-wide corridor). Transformer's comb is pulled in a
// little and its housings/waypoints are auto-avoided by nearest-legal snapping.
const MAZES: Record<string, Anchor[]> = {
  substation: comb(8, 42, 4, 0, 31, 8),
  switchyard: comb(8, 42, 4, 0, 31, 8),
  transformer: comb(6, 44, 4, 0, 31, 9),
};

// The "no-maze" clumps: a dense blob roughly in each map's centre.
const CLUMPS: Record<string, Anchor[]> = {
  substation: clump(20, 12, 6, 6),
  switchyard: clump(20, 12, 6, 6),
  transformer: clump(20, 10, 5, 6),
};

export function mazeFor(mapId: string): Anchor[] {
  return MAZES[mapId] ?? MAZES.substation!;
}
export function clumpFor(mapId: string): Anchor[] {
  return CLUMPS[mapId] ?? CLUMPS.substation!;
}
