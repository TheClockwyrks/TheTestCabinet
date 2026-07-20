// Automated validation for the Maps sub-item `leak-at-collector`.
//
// Matter that travels a path's full length reaches the collector and leaks: it is
// removed from play and the leak costs integrity through the real containment check. A
// real unit is posed just short of the collector, and stepping the real sim carries it
// the rest of the way; the snapshot confirms it is gone and integrity fell.

import { startRun, pathGeom, spawnAt, stepUntil, liveClip, unitById, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maps.leak-at-collector");

  const snap = await startRun(api, MAP.single, { integrity: 100000 });
  const g = pathGeom(snap.paths[0]);
  const id = await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: g.length - 25 });
  const intBefore = (await api.snapshot()).integrity;

  const r = await stepUntil(api, (s) => unitById(s, id) === null, 4, 0.1);
  check.expectOk("the unit reaches the collector and is removed", r.hit);
  check.expectLt("the leak costs integrity", r.snap.integrity, intBefore);

  await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: g.length - 60 });
  await liveClip(api, 1400);
  return check.verdict();
}
