// Automated validation for the Forge sub-item `setpoint-scales`.
//
// A Forge's setpoint rises with its level (72/84/96%; specs/heat.md, towers.md), so
// a maxed Forge settles a fed gun hotter than a level-I one. We settle the same Arc
// against a level-I and a level-III Forge (upgraded through the real upgrade code)
// and compare the heat it reaches.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

// Settle an Arc fed by a Forge upgraded to `forgeLevel`, returning its heat.
async function settleFed(api, forgeLevel) {
  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const forge = await build(api, "forge", 12, 14);
  for (let l = 1; l < forgeLevel; l += 1) await api.call("upgradeTower", forge);
  await api.call("setHeat", arc, 50);
  for (let i = 0; i < 60; i += 1) await api.step(0.25);
  return heatOf(api, arc);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("forge.setpoint-scales");

  const l1 = await settleFed(api, 1);
  const l3 = await settleFed(api, 3);

  check.expectGt("a level-III Forge settles a gun hotter than a level-I Forge", l3, l1);

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const forge = await build(api, "forge", 12, 14);
  await api.call("upgradeTower", forge);
  await api.call("upgradeTower", forge);
  await api.call("setHeat", arc, 40);
  await liveClip(api, 1800);
  return check.verdict();
}
