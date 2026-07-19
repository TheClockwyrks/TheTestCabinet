// Automated validation for the Hit Points sub-item `three-damage-types`.
//
// Shots carry one of three damage types on the projectile. The check builds each of the
// Emitter, Cleaver, and Reactor against a real target, steps until each launches a real
// projectile, and reads its `damageType` — energy, kinetic, and nuclear respectively.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, liveClip, MAP } from "../_helpers.mjs";

async function projType(api, kind) {
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, kind, g, s0);
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
  const r = await stepUntil(api, (s) => s.projectiles.length > 0, 3, 0.02);
  return r.hit ? r.snap.projectiles[0].damageType : null;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hitpoints.three-damage-types");

  check.expectEq("the Emitter fires energy", await projType(api, "emitter"), "energy");
  check.expectEq("the Cleaver fires kinetic", await projType(api, "cleaver"), "kinetic");
  check.expectEq("the Reactor fires nuclear", await projType(api, "reactor"), "nuclear");

  // Clip a reactor blast.
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  await placeCovering(api, "reactor", g, g.length * 0.18);
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: g.length * 0.18 });
  await liveClip(api, 1300);
  return check.verdict();
}
