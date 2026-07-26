// Automated validation for the Heavies sub-item `decays`.
//
// As it is worn down a heavy isotope sheds alpha (6-electron) and beta (2-electron) atoms
// and transmutes toward a stable nucleus, finally neutralizing. An Isotope carries 9
// shells and a chain of two alphas and a beta, which is more than one tower's coverage
// window will strip, so the check cracks it with a short battery of Cleavers and watches
// the real matter list as it passes: alpha and beta free atoms appear, and the isotope is
// finally gone.

import {
  startRun,
  pathGeom,
  battery,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

const MAX_CRACK_TICKS = 2400; // 2400 ticks = the old 40 s cap — game time, not wall clock

export default function item() {
  let id;
  let r;
  // Sightings accumulate across `act`; a fresh pair per pass.
  let sawAlpha;
  let sawBeta;

  return {
    id: "heavies.decays",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      await battery(api, "cleaver", g, g.length * 0.2, g.length * 0.7, 3);
      id = await spawnAt(api, { type: "isotope", pathId: 0, s: 0 });
      sawAlpha = false;
      sawBeta = false;
    },

    // The isotope walking the Cleaver line, shedding particles and transmuting down.
    async act(api) {
      // poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          for (const u of s.matter) {
            if (u.type === "atom" && u.id !== id) {
              if (u.electrons >= 6) sawAlpha = true;
              if (u.electrons === 2) sawBeta = true;
            }
          }
          return unitById(s, id) == null && sawAlpha && sawBeta;
        },
        { max: MAX_CRACK_TICKS, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectOk(
        "the heavy sheds an alpha (6-electron) atom as it decays",
        sawAlpha,
      );
      check.expectOk(
        "the heavy sheds a beta (2-electron) atom as it decays",
        sawBeta,
      );
      check.expectOk(
        "the worn heavy transmutes down and is finally neutralized",
        unitById(r.snap, id) == null,
      );
    },
  };
}
