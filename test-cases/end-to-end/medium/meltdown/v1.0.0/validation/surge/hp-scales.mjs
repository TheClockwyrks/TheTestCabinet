// Automated validation for the Surge sub-item `hp-scales`.
//
// A unit's HP scales up with the wave number (specs/surge.md — +20% per wave over
// wave 1), so a deep-wave unit is far tankier. A Mote is 40 HP at wave 1; at wave 6
// it is 40 * (1 + 0.2*5) = 80. We spawn a Mote at wave 1 and at wave 6 and compare.

import { newGame, spawn, unit } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.hp-scales");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 1000000);
  const w1 = await unit(api, await spawn(api, "mote", "left"));

  await api.call("setWave", 6);
  const w6 = await unit(api, await spawn(api, "mote", "left"));

  check.expectClose("a wave-1 Mote has base HP (40)", w1.maxHp, 40, 0.5);
  check.expectClose("a wave-6 Mote has scaled HP (80)", w6.maxHp, 80, 0.5);
  check.expectGt("HP scales up with the wave", w6.maxHp, w1.maxHp);

  await api.wait(80);
  await api.screenshot("scale");
  return check.verdict();
}
