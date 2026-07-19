// Automated validation for the Maps sub-item `branching-fork`.
//
// The medium map forks into two lanes that share an inlet and a collector and diverge
// between them. The check reads the two paths' polylines from the snapshot: identical
// endpoints (a shared inlet and collector) but a large vertical separation at mid-path
// (the divergence). It then poses a real unit on each lane and steps to confirm both
// lanes carry traffic.

import { startRun, pathGeom, spawnAt, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maps.branching-fork");

  const snap = await startRun(api, MAP.branching, { integrity: 100000 });
  check.expectEq("the branching map has two lanes", snap.paths.length, 2);

  const a = snap.paths[0].points;
  const b = snap.paths[1].points;
  // Shared inlet and collector (identical endpoints).
  check.expectClose("the two lanes share an inlet (x)", a[0].x, b[0].x, 2);
  check.expectClose("the two lanes share an inlet (y)", a[0].y, b[0].y, 2);
  check.expectClose("the two lanes share a collector (x)", a[a.length - 1].x, b[b.length - 1].x, 2);
  check.expectClose("the two lanes share a collector (y)", a[a.length - 1].y, b[b.length - 1].y, 2);

  // ...but diverge between them: at mid-path the lanes are far apart vertically.
  const ga = pathGeom(snap.paths[0]);
  const gb = pathGeom(snap.paths[1]);
  const midGap = Math.abs(ga.pointAt(ga.length * 0.5).y - gb.pointAt(gb.length * 0.5).y);
  check.expectGt("the lanes diverge at mid-path (Δy)", midGap, 150);

  // Both lanes carry real traffic.
  await spawnAt(api, { type: "atom", electrons: 2, pathId: 0, s: 30 });
  await spawnAt(api, { type: "atom", electrons: 2, pathId: 1, s: 30 });
  await api.step(0.5);
  const lanes = new Set((await api.snapshot()).matter.map((u) => u.pathId));
  check.expectOk("lane 0 carries matter", lanes.has(0));
  check.expectOk("lane 1 carries matter", lanes.has(1));

  await liveClip(api, 1400);
  return check.verdict();
}
