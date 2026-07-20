// Automated validation for the Detection sub-item `other-sources`.
//
// Detection is not one tower. The check confirms two further sources beyond the Catalyst
// each let inert matter be seen and hit: an Ionizer upgraded to its ARRAY branch (which
// grants detection), and a Beam (which sees inert natively at tier I). Each is posed
// against an undetected Noble and must damage it — proving it can see and hit inert
// matter on its own.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

async function arraySeesInert(api) {
  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  const t = await placeCovering(api, "ionizer", g, s0);
  await api.call("upgradeTower", t.id); // -> tier II
  await api.call("upgradeTower", t.id, "A"); // -> tier III ARRAY (detection)
  const id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });
  const hp0 = unitById(await api.snapshot(), id).hp;
  const r = await stepUntil(api, (s) => {
    const u = unitById(s, id);
    return u == null || u.hp < hp0;
  }, 3, 0.05);
  return r.hit;
}

async function beamSeesInert(api) {
  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "beam", g, s0);
  const id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });
  const hp0 = unitById(await api.snapshot(), id).hp;
  const r = await stepUntil(api, (s) => {
    const u = unitById(s, id);
    return u == null || u.hp < hp0;
  }, 3, 0.05);
  return r.hit;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("detection.other-sources");

  check.expectOk("an Ionizer's Array branch sees and hits inert matter", await arraySeesInert(api));
  check.expectOk("a Beam sees and hits inert matter natively", await beamSeesInert(api));

  await liveClip(api, 1000);
  return check.verdict();
}
