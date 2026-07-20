// Automated validation for hud.overload — the cargo readout shows OVERLOAD when the haul is too
// heavy for the jetpack to lift. This poses an over-limit load and captures the HUD; whether the
// readout actually reads OVERLOAD is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hud.overload");
  await newRun(api);
  await api.call("addCargo", "pyronium", 7); // ~406 kg — over the tier-1 lift limit
  await api.wait(150);
  check.expectEq("the load exceeds lift", (await api.snapshot()).miner.overloaded, true);
  await api.screenshot("overload");
  return check.verdict();
}
