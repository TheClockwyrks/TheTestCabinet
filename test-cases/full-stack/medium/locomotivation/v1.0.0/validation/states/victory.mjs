// State: the campaign-victory screen is reachable after the final level. The finale's quota
// is pre-satisfied and its clock run out, so winning the last level rolls into victory.

import { startFresh, primeQuota, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.victory");

  await startFresh(api, 6);
  await primeQuota(api, { delivered: { red: 1, green: 2, blue: 3 }, uniques: ["u-green", "u-red", "u-blue"] });
  await api.call("setClock", 1);
  await api.step(1.5); // run the clock out with the quota met → win the final level

  await settle(api, 150);
  check.expectEq("clearing the final level reaches victory", (await api.snapshot()).screen, "victory");
  await api.screenshot("state");
  return check.verdict();
}
