// Automated validation for the Maps sub-item `path-styles`.
//
// The maps span two path styles: smooth curves and straight lines with right-angle
// corners. The check reads each map's polyline and measures its sharpest turn: a curved
// map turns gently everywhere (no near-90-degree corners), while a straight/right-angle
// map turns at right angles and its runs are axis-aligned.

import { startRun, MAP } from "../_helpers.mjs";

function maxTurnDeg(points) {
  let maxTurn = 0;
  for (let i = 2; i < points.length; i += 1) {
    const a1 = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
    const a2 = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
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

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maps.path-styles");

  // A curved map: gentle, distributed turns — no right-angle corners.
  const curved = await startRun(api, MAP.single, { integrity: 100000 });
  check.expectLt("the curved map's sharpest turn is gentle (deg)", maxTurnDeg(curved.paths[0].points), 45);
  await api.wait(120);
  await api.screenshot("curved");

  // A straight map: axis-aligned runs with right-angle corners.
  const straight = await startRun(api, MAP.branching, { integrity: 100000 });
  check.expectGt("the straight map turns at right angles (deg)", maxTurnDeg(straight.paths[0].points), 70);
  check.expectGt("the straight map's runs are axis-aligned (fraction)", axisAlignedFrac(straight.paths[0].points), 0.9);
  await api.wait(120);
  await api.screenshot("straight");

  return check.verdict();
}
