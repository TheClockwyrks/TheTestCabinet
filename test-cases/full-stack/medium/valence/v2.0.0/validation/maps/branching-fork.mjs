// Automated validation for the Maps sub-item `branching-fork`.
//
// The medium map forks into lanes that COINCIDE on a shared stretch and diverge into
// distinct lanes between. specs/board.md pins the fork's shape but deliberately not which
// end of it is shared: "A branching map's fork is two paths that coincide on a shared trunk
// (the inlet approach) and/or a shared final run, then diverge into distinct lanes between
// them", and the lanes "may run separately and rejoin into a shared final run, or diverge
// to their own collectors" — endpoints may be shared or 1:1 either way. So the check READS
// the fork off the geometry: it samples the two lanes against each other, finds the longest
// stretch where they are the same world points (the shared trunk and/or final run), and the
// point where they are furthest apart (the divergence). Requiring identical inlets AND
// identical collectors instead pins the check to one of the arrangements board.md allows,
// and fails a conformant fork that diverges to its own collectors.
//
// Both lanes must also carry real traffic, which a posed unit on each confirms.

import {
  startRun,
  pathGeom,
  laneGaps,
  sharedStretch,
  widestGap,
  spawnAt,
  MAP,
} from "../_helpers.mjs";

// A shared segment is the SAME world points, not two lanes running near each other, so the
// tolerance is a few pixels of sampling slack rather than a lane's width.
const SHARED_TOL = 6;
// ...and a divergence has to be a genuinely distinct lane: a path reads as a channel over
// the substrate (specs/overview.md), so lanes this far apart cannot be read as one.
const DIVERGE_MIN = 100;

export default function item() {
  let snap0;
  let lanes;

  return {
    id: "maps.branching-fork",

    async arrange(api) {
      snap0 = await startRun(api, MAP.branching, { integrity: 100000 });
      // A real unit on each lane, whose travel `act` then confirms.
      await spawnAt(api, { type: "atom", electrons: 2, pathId: 0, s: 30 });
      await spawnAt(api, { type: "atom", electrons: 2, pathId: 1, s: 30 });
    },

    // Both lanes carrying real traffic — which is exactly what the fork is for, and what
    // the clip shows.
    async act(api) {
      // 30 ticks = the old 0.5 s.
      await api.advance(30);
      lanes = new Set((await api.snapshot()).matter.map((u) => u.pathId));
    },

    async assert(api, check) {
      check.expectGe(
        "the branching map forks into at least two lanes",
        snap0.paths.length,
        2,
      );

      const ga = pathGeom(snap0.paths[0]);
      const gb = pathGeom(snap0.paths[1]);
      const rows = laneGaps(ga, gb);

      // A shared stretch: somewhere the two lanes are the same conduit, so one tower
      // beside it covers both (the premium coverage of specs/board.md).
      const shared = sharedStretch(rows, { tol: SHARED_TOL });
      check.expectOk(
        "the two lanes coincide on a shared stretch (a trunk and/or a final run)",
        shared != null,
      );
      check.expectGt(
        "that shared stretch is a real run of conduit, not one touching point",
        shared ? shared.span : 0,
        0.02 * ga.length,
      );

      // ...and a divergence between: distinct lanes that each have to be defended.
      const widest = widestGap(rows);
      check.expectGt(
        "the lanes diverge into distinct lanes between (px apart at their widest)",
        widest.gap,
        DIVERGE_MIN,
      );

      check.expectOk("lane 0 carries matter", lanes.has(0));
      check.expectOk("lane 1 carries matter", lanes.has(1));
    },
  };
}
