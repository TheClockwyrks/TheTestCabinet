// Automated validation for the Tower Art sub-item `aim`.
//
// A damage tower's head rotates to face the unit it is firing at. The check builds an
// Emitter beside the lane, poses a unit in range, steps until the tower acquires it, and
// confirms the tower's reported heading points at the target's world position.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, towerById, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tower-art.aim");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.2;
  const t = await placeCovering(api, "emitter", g, s0);
  const id = await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });

  const r = await stepUntil(api, (s) => towerById(s, t.id).targetId === id, 1, 0.02);
  check.expectOk("the tower acquires the target", r.hit);
  const tw = towerById(r.snap, t.id);
  const u = unitById(r.snap, id);
  const expected = Math.atan2(u.y - (tw.y - 4), u.x - tw.x);
  let d = Math.abs(tw.angle - expected);
  if (d > Math.PI) d = 2 * Math.PI - d;
  check.expectLt("the tower's head points at its target (radians)", d, 0.2);

  await liveClip(api, 1200);
  return check.verdict();
}
