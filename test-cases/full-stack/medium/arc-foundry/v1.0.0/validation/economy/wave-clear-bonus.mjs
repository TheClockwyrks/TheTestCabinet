// Automated validation for economy.wave-clear-bonus: clearing a wave pays a small flat bonus
// in Charge (8 + 2*wave = 10 on Wave 1) and nothing else — there is no interest.
//
// A non-firing Regulator is kept so the wave produces NO kill bounties (nothing fires); all
// units leak (absorbed by high integrity) and the wave clears. The only Charge added is the
// wave-clear bonus, so the delta is exactly that bonus.
//
// Standing the Regulator up is all control ops (the arrange). The KEEP that launches the wave
// and the clear that pays the bonus are the behavior under test, so they are the act.

import { startBuild, placeCandidate, waveClearBonus, snap, actClearWave, SECOND } from "../_helpers.mjs";

export default function item() {
  // The candidate to keep, the Charge before the wave, and the snapshot at the clear.
  let candId;
  let c0;
  let end;

  return {
    id: "economy.wave-clear-bonus",

    // The still this item declares is the state after Wave 1 clears, and a real Wave 1
    // takes ~64 s to walk out — far past the 8 s default record budget, so the record
    // pass would unwind before `screenshot` ever ran and the declared output would
    // never land. The item declares no video, so this lengthens only the record pass,
    // not any media it produces.
    clipMs: 100000,

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);
      const cand = await placeCandidate(api, "regulator", 1, 6, 7); // non-firing: no kill income
      candId = cand.id;
      c0 = (await snap(api)).charge;
    },

    async act(api) {
      await api.call("keep", candId); // launches Wave 1
      end = await actClearWave(api, { maxTicks: 200 * SECOND });

      await api.screenshot("hud");
    },

    async assert(api, check) {
      check.expectEq("the build phase reopened after the wave cleared", end.phase, "build");
      check.expectEq("clearing Wave 1 paid the flat bonus (8 + 2*1 = 10) with no interest", end.charge - c0, waveClearBonus(1));
    },
  };
}
