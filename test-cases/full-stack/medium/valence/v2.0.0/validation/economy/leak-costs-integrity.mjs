// Automated validation for the Economy sub-item `leak-costs-integrity`.
//
// Matter that reaches the collector costs integrity equal to the unit's leak value. The
// check poses a heavy isotope (leak value 3) just short of the collector, steps until it
// leaks, and confirms integrity fell by exactly its leak value.

import { startRun, pathGeom, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

const ISOTOPE_LEAK = 3; // MATTER.heavy.leak — specs/matter.md

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.leak-costs-integrity");

  const snap = await startRun(api, MAP.single, { integrity: 100 });
  const g = pathGeom(snap.paths[0]);
  const id = await spawnAt(api, { type: "isotope", pathId: 0, s: g.length - 20 });
  const int0 = (await api.snapshot()).integrity;

  const r = await stepUntil(api, (s) => unitById(s, id) == null, 3, 0.05);
  check.expectOk("the unit leaked at the collector", r.hit);
  check.expectEq("the leak cost integrity equal to the unit's leak value", int0 - r.snap.integrity, ISOTOPE_LEAK);

  await spawnAt(api, { type: "isotope", pathId: 0, s: g.length - 60 });
  await liveClip(api, 1300);
  return check.verdict();
}
