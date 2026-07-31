// Automated validation for the Maps sub-item `multiple-separate`.
//
// The hard map lays several fully separate paths that "never share a lane, each carrying its
// own traffic from its own inlet toward a collector" (specs/board.md). Two things follow, and
// the check reads both off the geometry:
//
//   * each track starts at its OWN inlet — a distinct point, not one mouth feeding several
//     routes (which board.md allows in general, but not for this topology). It is the inlets
//     being distinct that matters, not how they are arranged: a spec-conformant hard map may
//     stack its tracks in horizontal bands, fan them from different edges, or run them
//     vertically, so the check measures the distance between inlets rather than assuming a
//     vertical stack (an earlier `Δy > 100` per inlet pair required one particular layout).
//   * no STRETCH is shared, anywhere along their length — "no stretch is shared, so coverage
//     cannot be doubled up; every front costs its own towers". That is a claim about a RUN of
//     conduit, not about the closest the two tracks ever come: two independent tracks are
//     perfectly entitled to CROSS, and board.md even contemplates a tower reaching two of them
//     where "they run close enough for its range". So the check measures the longest contiguous
//     run over which a pair coincides, and requires it to be a negligible part of the path. An
//     earlier form asserted the minimum separation anywhere, which a single right-angle
//     crossing drives to zero — it failed a conformant hard map of three separate tracks, one
//     of which crosses the other two.
//
// What this deliberately does not police is two tracks running side by side at a constant
// distance greater than the tolerance. specs/board.md pins the shared-stretch property, not a
// minimum lane spacing, and how legibly a board reads is a reviewer's judgement.

import {
  startRun,
  pathGeom,
  laneGaps,
  sharedStretch,
  MAP,
} from "../_helpers.mjs";

// Two inlets closer than this would read as one mouth rather than a front of its own.
const INLET_MIN = 60;
// Centrelines this close render as one channel rather than two (a path draws as a conduit tens
// of pixels wide, specs/overview.md), so a run of samples inside it is the two tracks
// coinciding rather than merely passing near each other.
//
// NOTE, for whoever revises this next: the PROPERTY here is straight out of board.md ("no
// stretch is shared"), but these two NUMBERS are not — the spec pins neither a lane width nor
// how much coincidence is too much, so they are calibrated rather than quoted. A right-angle
// crossing coincides for `2 * TOL / sin(angle)` ≈ 48 px, i.e. ~5% of a 1000 px track; two
// tracks laid on top of each other coincide for essentially all of it. 15% sits between those
// with room either side. What it cannot separate is a very SHALLOW crossing: below about 15°
// the coincident run alone exceeds the cap, and such a pair is judged to share a stretch. That
// is the intended reading — two tracks converging at 10° really do run together for 275 px —
// but it is a judgement the spec does not make, so a build refused on that basis deserves a
// look rather than an automatic fail.
const COINCIDE_TOL = 24;
const MAX_SHARED_FRAC = 0.15;

export default function item() {
  let snap0;

  return {
    id: "maps.multiple-separate",

    async arrange(api) {
      snap0 = await startRun(api, MAP.multiple, { integrity: 100000 });
    },

    // The board itself is the whole evidence here — nothing moves — so `act` is a paint
    // settle and the still it exists for. `settle` is a REAL pause in both passes, which
    // is what guarantees the posed map has actually been drawn before it is captured.
    async act(api) {
      await api.settle(150);
      await api.screenshot("map");
    },

    async assert(api, check) {
      // specs/board.md: "Hard, multiple separate paths. TWO OR MORE fully independent tracks
      // that never share a lane". Two is conformant — what makes the topology hard is that no
      // stretch is shared, so every front costs its own towers, which the separation check
      // below is what actually establishes. Demanding three fails a build that ships two
      // genuinely independent tracks.
      check.expectGe(
        "the hard map lays two or more separate paths",
        snap0.paths.length,
        2,
      );

      // Every track has its own inlet: the closest pair of inlets is still clearly apart.
      const inlets = snap0.paths.map((p) => p.points[0]);
      let closestInlets = Infinity;
      for (let i = 0; i < inlets.length; i += 1) {
        for (let j = i + 1; j < inlets.length; j += 1) {
          closestInlets = Math.min(
            closestInlets,
            Math.hypot(inlets[i].x - inlets[j].x, inlets[i].y - inlets[j].y),
          );
        }
      }
      check.expectGt(
        "each track has its own inlet (closest pair, px apart)",
        closestInlets,
        INLET_MIN,
      );

      // No stretch is shared: for every ordered pair, the longest run over which the two
      // coincide is a negligible fraction of the track. Sampled along the whole length, since
      // two tracks apart at their midpoints can still run together elsewhere.
      const geoms = snap0.paths.map((p) => pathGeom(p));
      let worst = 0;
      for (let i = 0; i < geoms.length; i += 1) {
        for (let j = 0; j < geoms.length; j += 1) {
          if (i === j) continue;
          const shared = sharedStretch(
            laneGaps(geoms[i], geoms[j], { samples: 400 }),
            { tol: COINCIDE_TOL },
          );
          if (shared) {
            worst = Math.max(worst, shared.span / geoms[i].length);
          }
        }
      }
      check.expectLt(
        "no two tracks share a stretch (longest coincident run, as a fraction of a track)",
        worst,
        MAX_SHARED_FRAC,
      );
    },
  };
}
