// Automated validation for the Placement sub-item `covers-both-lanes`.
//
// On a branching map a tower beside the shared/branch run reaches matter on BOTH lanes,
// while a tower beside a single divergent lane reaches only that one. The check builds a
// tower beside path 0's shared final run and confirms it fires on a real unit posed on
// each lane there; then builds a tower beside path 0's divergent stretch and confirms it
// does NOT reach a unit on the other lane's divergent stretch.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

async function firesOn(api, towerFrac, unitPathId, unitFrac) {
  const snap = await startRun(api, MAP.branching);
  const g0 = pathGeom(snap.paths[0]);
  await placeCovering(api, "emitter", g0, g0.length * towerFrac);
  const gU = pathGeom(snap.paths[unitPathId]);
  const id = await spawnAt(api, { type: "atom", electrons: 6, pathId: unitPathId, s: gU.length * unitFrac });
  const hp0 = unitById(await api.snapshot(), id).hp;
  const r = await stepUntil(api, (s) => {
    const u = unitById(s, id);
    return u == null || u.hp < hp0;
  }, 1.5, 0.1);
  const u = unitById(r.snap, id);
  return u != null && u.hp < hp0;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("placement.covers-both-lanes");

  // A tower beside the shared final run reaches a unit on each lane there.
  check.expectOk("a shared-run tower reaches lane 0", await firesOn(api, 0.95, 0, 0.92));
  check.expectOk("a shared-run tower reaches lane 1", await firesOn(api, 0.95, 1, 0.92));

  // A tower beside a single divergent lane does NOT reach the other lane.
  check.expectOk("a divergent-lane tower does NOT reach the other lane", (await firesOn(api, 0.5, 1, 0.5)) === false);

  // Clip: one shared-run tower firing on both lanes at once.
  const snap = await startRun(api, MAP.branching);
  const g0 = pathGeom(snap.paths[0]);
  const g1 = pathGeom(snap.paths[1]);
  await placeCovering(api, "emitter", g0, g0.length * 0.95);
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: g0.length * 0.9 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 1, s: g1.length * 0.9 });
  await liveClip(api, 1500);
  return check.verdict();
}
