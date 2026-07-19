// Automated validation for the Heavies sub-item `decays`.
//
// As it is worn down a heavy isotope sheds alpha (6-electron) and beta (2-electron)
// atoms and transmutes toward a stable nucleus, finally neutralizing. The check cracks a
// heavy with a Cleaver and watches the real matter list: free atoms with 6 electrons
// (alpha) and 2 electrons (beta) appear as it decays, and the isotope is finally gone.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heavies.decays");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.15;
  await placeCovering(api, "cleaver", g, s0);
  // Spawn upstream so the heavy traverses the tower's full coverage window while it decays.
  const id = await spawnAt(api, { type: "isotope", pathId: 0, s: s0 - 40 });

  let sawAlpha = false;
  let sawBeta = false;
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) {
      if (u.type === "atom" && u.id !== id) {
        if (u.electrons >= 6) sawAlpha = true;
        if (u.electrons === 2) sawBeta = true;
      }
    }
    return unitById(s, id) == null && sawAlpha && sawBeta;
  }, 8, 0.05);

  check.expectOk("the heavy sheds an alpha (6-electron) atom as it decays", sawAlpha);
  check.expectOk("the heavy sheds a beta (2-electron) atom as it decays", sawBeta);
  check.expectOk("the worn heavy transmutes down and is finally neutralized", unitById(r.snap, id) == null);

  await liveClip(api, 1400);
  return check.verdict();
}
