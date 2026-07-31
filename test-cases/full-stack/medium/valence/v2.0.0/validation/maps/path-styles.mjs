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

function maxTurnDeg(points) {
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
  return (maxTurn * 180) / Math.PI;
}

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

      check.expectLt(
        "the curved map's sharpest turn is gentle (deg)",
        curved ? maxTurnDeg(curved.paths[0].points) : 180,
        45,
      );
      check.expectGt(
        "the straight map turns at right angles (deg)",
        straight ? maxTurnDeg(straight.paths[0].points) : 0,
        70,
      );
      check.expectGt(
        "the straight map's runs are axis-aligned (fraction)",
        straight ? axisAlignedFrac(straight.paths[0].points) : 0,
        0.9,
      );
    },
  };
}
