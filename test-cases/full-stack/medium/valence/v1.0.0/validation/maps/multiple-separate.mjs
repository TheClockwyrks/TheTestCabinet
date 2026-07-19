// Automated validation for the Maps sub-item `multiple-separate`.
//
// The hard map lays several fully separate paths that share no stretch. The check reads
// the paths from the snapshot: three or more of them, with inlets at distinct heights
// and mid-sections that never coincide (a large minimum gap between any two), so no
// stretch is shared and every front demands its own towers.

import { startRun, pathGeom, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maps.multiple-separate");

  const snap = await startRun(api, MAP.multiple, { integrity: 100000 });
  check.expectGe("the hard map has several separate paths", snap.paths.length, 3);

  const geoms = snap.paths.map((p) => pathGeom(p));
  const inletYs = snap.paths.map((p) => p.points[0].y).sort((x, y) => x - y);
  for (let i = 1; i < inletYs.length; i += 1) {
    check.expectGt(`inlet ${i} sits clear of inlet ${i - 1} (Δy)`, inletYs[i] - inletYs[i - 1], 100);
  }

  // Closest mid-path approach between any two paths stays well above a shared stretch's
  // zero clearance.
  let minGap = Infinity;
  for (let i = 0; i < geoms.length; i += 1) {
    for (let j = i + 1; j < geoms.length; j += 1) {
      const pi = geoms[i].pointAt(geoms[i].length * 0.5);
      const pj = geoms[j].pointAt(geoms[j].length * 0.5);
      minGap = Math.min(minGap, Math.hypot(pi.x - pj.x, pi.y - pj.y));
    }
  }
  check.expectGt("no two paths coincide (min mid-path gap)", minGap, 80);

  await api.wait(150);
  await api.screenshot("map");
  return check.verdict();
}
