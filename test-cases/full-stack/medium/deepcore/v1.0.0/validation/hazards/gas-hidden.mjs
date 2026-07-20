// Automated validation for hazards.gas-hidden.
//
// A gas pocket renders with the same band-rock texture as ordinary rock (its only tell is a subtle
// seep VFX), so it cannot be told from plain rock by color alone — unlike the plainly-visible lava.
// We sample the rendered pixels of a gas tile, a plain rock tile, and a lava tile side by side.

import { newRun, SPAWN_COL, ROCKBED_ROW, sampleTile, colorDistance } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.gas-hidden");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col + 1, row, { kind: "gas" });
  await api.call("setTile", col + 2, row, { kind: "rock" });
  await api.call("setTile", col + 3, row, { kind: "lava" });
  await api.wait(150);

  const gas = await sampleTile(api, col + 1, row);
  const rock = await sampleTile(api, col + 2, row);
  const lava = await sampleTile(api, col + 3, row);

  check.expectLt("gas renders like plain rock (hidden)", colorDistance(gas, rock), 35);
  check.expectGt("gas is NOT drawn like the obvious lava hazard", colorDistance(gas, lava), 60);

  await api.screenshot("hidden");
  return check.verdict();
}
