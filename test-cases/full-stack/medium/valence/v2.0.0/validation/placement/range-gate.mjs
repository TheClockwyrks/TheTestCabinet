// Automated validation for the Placement sub-item `range-gate`.
//
// A tower reaches only matter within its range. The check builds one emitter and poses
// two real units: one at the tower's own point (in range) and one far along the path,
// spatially distant (out of range). Stepping the real sim damages only the near one.

import { startRun, pathGeom, placeCovering, spawnAt, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("placement.range-gate");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "emitter", g, s0);
  const near = await spawnAt(api, { type: "atom", electrons: 5, pathId: 0, s: s0 });
  const far = await spawnAt(api, { type: "atom", electrons: 5, pathId: 0, s: g.length * 0.5 });

  const nearHp0 = unitById(await api.snapshot(), near).hp;
  const farHp0 = unitById(await api.snapshot(), far).hp;
  await api.step(1.2);
  const now = await api.snapshot();

  check.expectLt("the in-range unit is fired on (hp drops)", unitById(now, near).hp, nearHp0);
  check.expectEq("the out-of-range unit is untouched (hp unchanged)", unitById(now, far).hp, farHp0);

  await liveClip(api, 1200);
  return check.verdict();
}
