// Automated validation for the Detection sub-item `catalyst-lingers`.
//
// An inert unit stays revealed for a short linger after it leaves the detector's field,
// then reverts to hidden. The check reveals a Noble with a Catalyst, then SELLS the
// Catalyst (removing the field) and steps: the reveal lingers briefly, then clears.

import { startRun, pathGeom, placeCovering, spawnAt, liveClip, unitById, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("detection.catalyst-lingers");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  const cat = await placeCovering(api, "catalyst", g, s0);
  const id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });

  await api.step(0.1);
  check.expectEq("the inert unit is revealed while in the field", unitById(await api.snapshot(), id).revealed, true);

  // Remove the detector: the reveal must linger briefly, then clear.
  await api.call("sellTower", cat.id);
  await api.step(0.5);
  check.expectEq("the reveal lingers just after the detector is gone", unitById(await api.snapshot(), id).revealed, true);
  await api.step(2.2);
  check.expectEq("the reveal clears after the linger elapses", unitById(await api.snapshot(), id).revealed, false);

  await liveClip(api, 1200);
  return check.verdict();
}
