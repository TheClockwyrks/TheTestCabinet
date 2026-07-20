// Automated validation for the Detection sub-item `catalyst`.
//
// A Catalyst's aura reveals inert matter in its field, after which a nearby damage tower
// can fire on it. The check places a Catalyst and an Emitter over the same point, poses
// an inert Noble there, and steps: the noble is revealed and the emitter then damages it.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("detection.catalyst");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "catalyst", g, s0);
  await placeCovering(api, "emitter", g, s0);
  const id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });

  await api.step(0.1);
  check.expectEq("the Catalyst reveals the inert unit", unitById(await api.snapshot(), id).revealed, true);

  const hp0 = unitById(await api.snapshot(), id).hp;
  const r = await stepUntil(api, (s) => {
    const u = unitById(s, id);
    return u == null || u.hp < hp0;
  }, 3, 0.05);
  check.expectOk("a nearby tower can now fire on the revealed inert unit", r.hit);

  await liveClip(api, 1300);
  return check.verdict();
}
