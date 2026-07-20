// Automated validation for the Maps sub-item `single-path`.
//
// The easy map is ONE continuous path. A real unit posed at the inlet advances along
// it (its progress grows as the real movement system steps), and a unit posed near the
// collector reaches the end and leaks — the real containment cost resolving, not a
// fabricated end. Nothing here announces the outcome; `step` runs the real sim and
// `snapshot` reads it back.

import { startRun, pathGeom, spawnAt, stepUntil, liveClip, unitById, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maps.single-path");

  const snap = await startRun(api, MAP.single, { integrity: 100000 });
  check.expectEq("the easy map has a single path", snap.paths.length, 1);

  const g = pathGeom(snap.paths[0]);

  // A unit at the inlet advances toward the collector.
  const flowId = await spawnAt(api, { type: "atom", electrons: 2, pathId: 0, s: 5 });
  const p0 = unitById(await api.snapshot(), flowId).progress;
  await api.step(1.5);
  const p1 = unitById(await api.snapshot(), flowId).progress;
  check.expectGt("the unit advances toward the collector (progress)", p1, p0 + 20);

  // A unit that reaches the collector leaks: it is removed and integrity drops.
  const intBefore = (await api.snapshot()).integrity;
  await spawnAt(api, { type: "atom", electrons: 2, pathId: 0, s: g.length - 20 });
  const r = await stepUntil(api, (s) => s.integrity < intBefore, 4, 0.1);
  check.expectOk("a unit reaching the collector leaks", r.hit);
  check.expectLt("the leak costs integrity", r.snap.integrity, intBefore);

  // A live clip of matter flowing the single path.
  await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: 5 });
  await liveClip(api, 1400);
  return check.verdict();
}
