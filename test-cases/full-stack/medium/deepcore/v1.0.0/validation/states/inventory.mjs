// Automated validation for states.inventory — the inventory (cargo hold) overlay is opened (with a
// haul to show) and captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.inventory");
  await newRun(api);
  await api.call("addCargo", "ferron", 4); // held ore so the overlay has content + weights
  await api.call("openInventory");
  await api.wait(150);
  check.expectEq("the inventory overlay is open", (await api.snapshot()).panel, "inventory");
  await api.screenshot("inventory");
  return check.verdict();
}
