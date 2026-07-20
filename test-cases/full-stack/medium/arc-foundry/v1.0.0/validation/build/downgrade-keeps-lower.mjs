// Automated validation for build.downgrade-keeps-lower: DOWNGRADE harvests the selected
// candidate as a firing component one quality tier lower and, being the harvest, launches
// the wave.
//
// Opening the run and dropping the Charged candidate are control ops (the arrange). The
// DOWNGRADE is the behavior under test, so it is the act — and because a downgrade IS the
// harvest, the clip carries on into the wave it launched, which is one of the things asserted.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

// How much of the launched wave to show after the downgrade. Two seconds is enough for the
// first units to walk in, which is what "it launched the wave" looks like on screen.
const WAVE_TICKS = 2 * SECOND;

export default function item() {
  // The candidate the act downgrades, and the board at the instant it resolved.
  let candId;
  let s;

  return {
    id: "build.downgrade-keeps-lower",

    async arrange(api) {
      await startBuild(api);
      const cand = await placeCandidate(api, "capacitor", 3, 6, 7); // a Charged (T3) candidate
      candId = cand.id;
    },

    async act(api) {
      await api.call("downgrade", candId);
      s = await snap(api);

      // The assertions are already fixed on `s`; this only lets the clip depict the wave the
      // downgrade launched.
      await api.advance(WAVE_TICKS);
    },

    async assert(api, check) {
      const at = towerAt(s, 6, 7);
      check.expectEq("downgrade harvested the candidate as a firing component", at.kind, "component");
      check.expectEq("...one quality tier lower (T3 -> T2)", at.quality, 2);
      check.expectEq("downgrade is the harvest, so it launched the wave", s.phase, "wave");
    },
  };
}
