// Automated validation for the Boss sub-item `fragments`.
//
// A worn-down Macromass fountains alpha (6-electron) and beta (2-electron) atoms as it
// decays, rather than merely draining a hit-point bar. The check poses the boss under a
// cluster of nuclear/kinetic towers and watches: as its hit points fall, both alpha and
// beta free atoms appear on its path.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("boss.fragments");

  const snap = await startRun(api, MAP.single, { energy: 100000, integrity: 1e9 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.14;
  await placeCovering(api, "reactor", g, s0);
  await placeCovering(api, "reactor", g, s0 + 30);
  await placeCovering(api, "cleaver", g, s0 + 60);
  const id = await spawnAt(api, { type: "macromass", pathId: 0, s: s0 });
  const hp0 = unitById(await api.snapshot(), id).hp;

  let sawAlpha = false;
  let sawBeta = false;
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) {
      if (u.type === "atom") {
        if (u.electrons >= 6) sawAlpha = true;
        if (u.electrons === 2) sawBeta = true;
      }
    }
    return sawAlpha && sawBeta;
  }, 14, 0.05);

  check.expectOk("the boss sheds an alpha (6-electron) fragment as it decays", sawAlpha);
  check.expectOk("the boss sheds a beta (2-electron) fragment as it decays", sawBeta);
  const u = unitById(r.snap, id);
  check.expectOk("the boss is worn down under fire", u == null || u.hp < hp0);

  await liveClip(api, 1500);
  return check.verdict();
}
