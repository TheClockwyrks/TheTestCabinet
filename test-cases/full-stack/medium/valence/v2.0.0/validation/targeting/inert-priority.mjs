// Automated validation for the Targeting sub-item `inert-priority`.
//
// With detection present, a tower's inert-priority toggle makes it fire at revealed
// inert matter first; toggling it on must NEVER make an undetected inert unit
// targetable. The check poses a revealed noble (via a Catalyst) alongside an ordinary
// atom: default targeting takes the atom, inert-priority flips it to the noble. Then a
// second scene with NO detector confirms inert-priority never targets the hidden noble.

import { startRun, pathGeom, placeCovering, spawnAt, FIXED, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.inert-priority");

  // Detector present: inert-priority prefers the revealed inert unit.
  {
    const snap = await startRun(api, MAP.single);
    const g = pathGeom(snap.paths[0]);
    const s0 = g.length * 0.2;
    await placeCovering(api, "catalyst", g, s0);
    const em = await placeCovering(api, "emitter", g, s0);
    const noble = await spawnAt(api, { type: "noble", pathId: 0, s: s0 - 40 });
    const atom = await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: s0 + 40 });
    await api.step(FIXED); // the Catalyst reveals the noble; the emitter picks a target
    let tw = (await api.snapshot()).towers.find((x) => x.id === em.id);
    check.expectEq("without inert-priority the tower takes the FIRST atom", tw.targetId, atom);
    await api.call("setInertPriority", em.id, true);
    await api.step(FIXED);
    tw = (await api.snapshot()).towers.find((x) => x.id === em.id);
    check.expectEq("with inert-priority it prefers the revealed inert unit", tw.targetId, noble);
  }

  // No detector: inert-priority must not make an undetected inert unit targetable.
  {
    const snap = await startRun(api, MAP.single);
    const g = pathGeom(snap.paths[0]);
    const s0 = g.length * 0.2;
    const em = await placeCovering(api, "emitter", g, s0);
    const noble = await spawnAt(api, { type: "noble", pathId: 0, s: s0 - 40 });
    const atom = await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: s0 + 40 });
    await api.call("setInertPriority", em.id, true);
    await api.step(FIXED);
    const tw = (await api.snapshot()).towers.find((x) => x.id === em.id);
    check.expectNe("an undetected inert unit is never targeted", tw.targetId, noble);
    check.expectEq("the tower takes the visible atom instead", tw.targetId, atom);
  }

  await api.call("setAutoStep", true);
  await api.wait(900);
  return check.verdict();
}
