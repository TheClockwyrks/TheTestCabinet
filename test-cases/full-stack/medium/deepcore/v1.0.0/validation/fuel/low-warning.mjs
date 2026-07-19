// Automated validation for fuel.low-warning.
//
// The fuel gauge turns to its alert color (and a low-fuel alarm plays) under 20% of the tank. This
// reaches that state — fuel set below 20% on an underground miner — and captures the HUD; whether
// the gauge actually reads as an alert is judged by eye from the capture.

import { newRun, solid, ROCKBED_ROW, SPAWN_COL } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fuel.low-warning");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await solid(api, col, row + 1);
  await api.call("teleport", col, row);
  const max = (await api.snapshot()).miner.maxFuel;
  await api.call("setFuel", max * 0.12); // well under the 20% warning threshold

  await api.wait(150); // let a frame paint the alerted gauge
  const snap = await api.snapshot();
  check.expectLt("fuel is under the 20% warning threshold", snap.miner.fuel / snap.miner.maxFuel, 0.2);
  await api.screenshot("warning");

  return check.verdict();
}
