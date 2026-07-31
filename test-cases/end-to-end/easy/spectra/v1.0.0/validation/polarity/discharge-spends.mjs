// Automated validation for the Polarity sub-item `discharge-spends`.
//
// Firing a discharge spends the entire resonance meter, dropping it to zero. The
// meter is filled, a REAL discharge fired, and the meter read back.

import { startClean, LEAD_IN_TICKS } from "../_helpers.mjs";

export default function item() {
  // The meter just before the discharge and the state immediately after it.
  let before;
  let snap;

  return {
    id: "polarity.discharge-spends",

    // A live stage-1 wave with the meter posed full, its swarm kept so the wave the
    // discharge fires is visibly sweeping something.
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setResonance", 100);
    },

    async act(api) {
      // Show the FULL meter before spending it. The item is a before/after about the
      // meter, and discharging at the top of `act` left a clip that only ever showed
      // a meter reading zero, with nothing to say it had been full. Hold on the
      // charged meter first; the swarm keeps flying in behind it.
      await api.advance(LEAD_IN_TICKS);

      // Read the meter at the last instant before the discharge, so the "before"
      // value is the one the discharge actually spends.
      before = (await api.snapshot()).resonance;

      await api.call("discharge");
      // Read immediately: spending is instantaneous, so this catches the meter at
      // the moment it drops rather than after anything could have refilled it.
      snap = await api.snapshot();

      // Let the wave expand so the clip shows what the spent meter bought.
      await api.advance(156); // 156 ticks = the old liveWaveClip's 1300 ms
    },

    async assert(api, check) {
      check.expectEq("the meter is full before the discharge", before, 100);
      check.expectEq("a discharge spends the whole meter", snap.resonance, 0);
      check.expectOk(
        "the discharge wave is live",
        snap.discharge.active === true,
      );
    },
  };
}
