// Automated validation for states.ore-market — the Ore Market panel is opened (with a haul to show
// the breakdown) and captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.ore-market");
  await newRun(api);
  await api.call("addCargo", "cuprite", 3); // a haul so the cargo breakdown has content
  await api.call("openPanel", "ore-market");
  await api.wait(150);
  check.expectEq("the Ore Market panel is open", (await api.snapshot()).panel, "ore-market");
  await api.screenshot("ore-market");
  return check.verdict();
}
