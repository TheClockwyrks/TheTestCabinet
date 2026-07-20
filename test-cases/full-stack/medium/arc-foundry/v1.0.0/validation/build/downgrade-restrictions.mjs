// Automated validation for build.downgrade-restrictions: only a candidate at Tuned (T2) or
// above can be downgraded; a Scrap (T1) candidate cannot.
//
// A Scrap candidate is placed and a downgrade attempted; it stays a candidate and no wave is
// launched (the control was a no-op).

import { startBuild, placeCandidate, towerAt, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.downgrade-restrictions");

  await startBuild(api);
  const cand = await placeCandidate(api, "capacitor", 1, 6, 7); // Scrap (T1)
  await api.call("downgrade", cand.id);

  const s = await snap(api);
  check.expectEq("a Scrap (T1) candidate is not downgraded (still a candidate)", towerAt(s, 6, 7).kind, "candidate");
  check.expectEq("...still at Scrap", towerAt(s, 6, 7).quality, 1);
  check.expectEq("...and no wave was launched", s.phase, "build");

  await api.screenshot("restrict");
  return check.verdict();
}
