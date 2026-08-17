// Automated validation for the Maps sub-item `path-styles`.
//
// The maps span two path styles: smooth curves and straight lines with right-angle
// corners. specs/board.md requires both to appear SOMEWHERE in the set and leaves which
// map takes which to the build — "The single-path, branching, and multiple-path maps above
// may each pick either style, so long as both styles appear somewhere in the set" — so the
// check asks the catalog which map is which (the `style` each map DECLARES in the
// snapshot's `maps` list, specs/instrumentation.md) and then measures whether the geometry
// bears that declaration out: a curved map turns gently everywhere (no near-90-degree
// corners), a straight map turns at right angles and its runs are axis-aligned.
//
// Pairing a style with a topology instead — the curved map is the single-path one, the
// straight map is the branching one — describes only one of the conformant arrangements,
// and would fail a build that draws its single path straight and its fork in curves.
//
// TWO runs. The curved map is arranged; the straight map is posed inside `act` with
// `poseRun`, the twin that selects a map with control ops alone — `api.reset` throws
// there.

// A build that offers no map in one of the styles has broken the requirement this item
// exists to check, so the catalog is read FIRST and each style is only selected if it is
// there. Asking `poseRun` for a style the build does not have throws, which the runtime
// reports as a broken debug API — the harshest signal there is, pinned on the wrong thing.
import { poseRun, STYLE } from "../_helpers.mjs";

/**
 * The sharpest CORNER on a polyline, as the interior angle between the two runs that meet
 * at it, in degrees: 180 is dead straight, 90 is a right angle, and smaller still is a
 * hairpin. The minimum over every vertex, so it reports the one worst corner on the path.
 *
 * The corner angle rather than the TURN angle (how far the heading swings, 0 for straight
 * and 180 for a reversal), though the two carry identical information — `corner = 180 −
 * turn` — because only one of them can be read off the failure line without a diagram. A
 * curved map that kinks 58 degrees off its heading used to report "the curved map's
 * sharpest turn is gentle (deg): expected < 45, got 58", which invites exactly the reading
 * it does not mean: 58 sounds like an acute, and therefore sharp, angle that the check has
 * somehow demanded be sharper still. Stated as a corner the same geometry reads "the
 * curved map's sharpest corner stays open (deg): expected > 135, got 122" — a corner that
 * bends further than a smooth path should, which is the finding.
 */
function sharpestCornerDeg(points) {
  let maxTurn = 0;
  for (let i = 2; i < points.length; i += 1) {
    const a1 = Math.atan2(
      points[i - 1].y - points[i - 2].y,
      points[i - 1].x - points[i - 2].x,
    );
    const a2 = Math.atan2(
      points[i].y - points[i - 1].y,
      points[i].x - points[i - 1].x,
    );
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    maxTurn = Math.max(maxTurn, d);
  }
  return 180 - (maxTurn * 180) / Math.PI;
}

// The corner a smooth path must stay more open than, and the one a right-angle path must
// corner at least as tightly as. Both are the same thresholds the turn-angle form used
// (45 and 70 degrees of swing), restated as corners, so no build's verdict moves: a
// gentle sweep leaves every corner wider than 135, and a 90-degree circuit corner is
// comfortably under 110.
const CURVED_MIN_CORNER_DEG = 135;
const STRAIGHT_MAX_CORNER_DEG = 110;

function axisAlignedFrac(points) {
  let aligned = 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dy = Math.abs(points[i].y - points[i - 1].y);
    if (dx + dy < 0.01) continue;
    total += 1;
    if (dx < 0.5 || dy < 0.5) aligned += 1;
  }
  return total ? aligned / total : 0;
}

export default function item() {
  let catalog;
  let curved;
  let straight;

  return {
    id: "maps.path-styles",

    // Read the catalog, then open a run on whichever map DECLARES the curved style —
    // resolved from that catalog rather than assumed to be one particular topology.
    async arrange(api) {
      await api.reset({ seed: 1 });
      catalog = (await api.snapshot()).maps;
      if (catalog.some((m) => m.style === STYLE.curved)) {
        curved = await poseRun(api, STYLE.curved, { integrity: 100000 });
      }
    },

    // Both boards, each given a real repaint pause before it is captured. Nothing moves
    // in either — the geometry IS the evidence — so the two stills are the whole clip.
    async act(api) {
      await api.settle(120);
      await api.screenshot("curved");

      // ...and whichever map declares the straight style.
      if (catalog.some((m) => m.style === STYLE.straight)) {
        straight = await poseRun(api, STYLE.straight, { integrity: 100000 });
      }
      await api.settle(120);
      await api.screenshot("straight");
    },

    async assert(api, check) {
      // Both styles must appear in the set at all; the geometry checks below then hold
      // each map to the style it claims.
      check.expectOk("the map set offers a curved-style map", curved != null);
      check.expectOk(
        "the map set offers a straight, right-angle map",
        straight != null,
      );

      // Each default is the value that FAILS its own assertion, so a missing map reports as
      // the unmet requirement it is rather than passing on a placeholder.
      check.expectGt(
        "the curved map's sharpest corner stays open — no hard corners (deg)",
        curved ? sharpestCornerDeg(curved.paths[0].points) : 0,
        CURVED_MIN_CORNER_DEG,
      );
      check.expectLt(
        "the straight map corners at right angles (deg)",
        straight ? sharpestCornerDeg(straight.paths[0].points) : 180,
        STRAIGHT_MAX_CORNER_DEG,
      );
      check.expectGt(
        "the straight map's runs are axis-aligned (fraction)",
        straight ? axisAlignedFrac(straight.paths[0].points) : 0,
        0.9,
      );
    },
  };
}
