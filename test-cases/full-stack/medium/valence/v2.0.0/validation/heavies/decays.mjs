// Automated validation for the Heavies sub-item `decays`.
//
// As it is worn down a heavy isotope sheds alpha (6-electron) and beta (2-electron) atoms
// and transmutes toward a stable nucleus, finally neutralizing. An Isotope carries 9
// shells and a chain of two alphas and a beta, which is more than one tower's coverage
// window will strip, so the check cracks it with a short battery of Cleavers and watches
// the real matter list as it passes: alpha and beta free atoms appear, and the isotope is
// finally gone.

import { startRun, pathGeom, battery, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

const MAX_CRACK_SECONDS = 40; // generous: game time on the manual clock, not wall clock

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heavies.decays");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  await battery(api, "cleaver", g, g.length * 0.2, g.length * 0.7, 3);
  const id = await spawnAt(api, { type: "isotope", pathId: 0, s: 0 });

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
  }, MAX_CRACK_SECONDS, 0.05);

  check.expectOk("the heavy sheds an alpha (6-electron) atom as it decays", sawAlpha);
  check.expectOk("the heavy sheds a beta (2-electron) atom as it decays", sawBeta);
  check.expectOk("the worn heavy transmutes down and is finally neutralized", unitById(r.snap, id) == null);

  await liveClip(api, 1400);
  return check.verdict();
}
