// Automated validation for the Heavies sub-item `disruptor-beam`.
//
// A plain Beam (energy) cannot touch a heavy, but its tier-III Disruptor branch gains
// heavy damage — so more than one tower can crack heavies, an identity earned by a
// branch. The check pits a plain Beam and a Disruptor Beam against identical heavies and
// confirms only the Disruptor wears the heavy down.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

async function beamVsHeavy(api, disruptor) {
  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.15;
  const t = await placeCovering(api, "beam", g, s0);
  if (disruptor) {
    await api.call("upgradeTower", t.id); // -> tier II
    await api.call("upgradeTower", t.id, "B"); // -> tier III Disruptor
  }
  const id = await spawnAt(api, { type: "isotope", pathId: 0, s: s0 });
  const hp0 = unitById(await api.snapshot(), id).hp;
  const r = await stepUntil(api, (s) => {
    const u = unitById(s, id);
    return u == null || u.hp < hp0;
  }, 3, 0.05);
  return r.hit;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heavies.disruptor-beam");

  check.expectOk("a plain Beam cannot crack a heavy", (await beamVsHeavy(api, false)) === false);
  check.expectOk("a Disruptor Beam cracks a heavy", (await beamVsHeavy(api, true)) === true);

  // Clip the Disruptor cracking a heavy.
  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const t = await placeCovering(api, "beam", g, g.length * 0.15);
  await api.call("upgradeTower", t.id);
  await api.call("upgradeTower", t.id, "B");
  await spawnAt(api, { type: "isotope", pathId: 0, s: g.length * 0.15 });
  await liveClip(api, 1400);
  return check.verdict();
}
