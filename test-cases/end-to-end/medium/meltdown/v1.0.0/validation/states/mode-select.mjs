// Automated validation for the States sub-item `mode-select`.
//
// PLAY opens a mode-select menu (specs/states.md, modes.md). We navigate there with
// injected keys and capture it.

import { press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.mode-select");
  await api.reset();
  await press(api, "Enter"); // PLAY
  await api.wait(120);
  check.expectEq("PLAY opens mode select", (await api.snapshot()).screen, "modeselect");
  await api.screenshot("modeselect");
  return check.verdict();
}
