// Automated validation for build.five-stamps-cap: a level grants five stamps; a sixth
// placement is refused, and the cap holds regardless of Charge.

import { startBuild, SPOTS, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.five-stamps-cap");

  const s0 = await startBuild(api);
  check.expectEq("a level grants five stamps", s0.stampsLeft, 5);

  for (const spot of SPOTS) {
    await api.call("setNextRoll", "capacitor", 1);
    await api.call("placeRock", spot.col, spot.row);
  }
  const s1 = await snap(api);
  check.expectEq("five placements exhaust the allowance", s1.stampsLeft, 0);
  const placed = s1.towers.length;

  // A sixth placement (a legal spot) is refused because the allowance is spent.
  await api.call("setNextRoll", "capacitor", 1);
  await api.call("placeRock", 14, 7);
  check.expectEq("a sixth placement is refused", (await snap(api)).towers.length, placed);

  // The cap is independent of Charge.
  await api.call("setCharge", 9999);
  await api.call("setNextRoll", "capacitor", 1);
  await api.call("placeRock", 14, 7);
  check.expectEq("the five-stamp cap holds regardless of Charge", (await snap(api)).towers.length, placed);

  await api.screenshot("cap");
  return check.verdict();
}
