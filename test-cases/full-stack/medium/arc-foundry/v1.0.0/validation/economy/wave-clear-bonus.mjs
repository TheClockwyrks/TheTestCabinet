// Automated validation for economy.wave-clear-bonus: clearing a wave pays a small flat bonus
// in Charge (8 + 2*wave = 10 on Wave 1) and nothing else — there is no interest.
//
// A non-firing Regulator is kept so the wave produces NO kill bounties (nothing fires); all
// units leak (absorbed by high integrity) and the wave clears. The only Charge added is the
// wave-clear bonus, so the delta is exactly that bonus.

import { startBuild, placeCandidate, waveClearBonus, snap, clearWave } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.wave-clear-bonus");

  await startBuild(api);
  await api.call("setIntegrity", 999);
  const cand = await placeCandidate(api, "regulator", 1, 6, 7); // non-firing: no kill income
  const c0 = (await snap(api)).charge;

  await api.call("keep", cand.id); // launches Wave 1
  const end = await clearWave(api, 200);

  check.expectEq("the build phase reopened after the wave cleared", end.phase, "build");
  check.expectEq("clearing Wave 1 paid the flat bonus (8 + 2*1 = 10) with no interest", end.charge - c0, waveClearBonus(1));

  await api.screenshot("hud");
  return check.verdict();
}
