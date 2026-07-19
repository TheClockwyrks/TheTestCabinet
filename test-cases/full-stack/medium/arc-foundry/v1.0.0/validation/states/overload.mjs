// Automated validation for states.overload: driving Grid Integrity to 0 reaches the Overload
// (defeat) screen.

import { startBuild, spawnControlled, snap, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.overload");

  await startBuild(api);
  await api.call("setIntegrity", 1);
  await spawnControlled(api, "slug"); // leak 2 -> integrity below zero

  const r = await stepUntil(api, (s) => s.screen === "overload", 150, 0.5);
  check.expectOk("the run overloads (defeat)", r.hit);
  check.expectEq("the Overload screen shows", (await snap(api)).screen, "overload");

  await api.screenshot("overload");
  return check.verdict();
}
