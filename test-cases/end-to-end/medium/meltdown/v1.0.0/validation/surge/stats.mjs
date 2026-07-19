// Automated validation for the Surge sub-item `stats`.
//
// The surge types field their specified base HP and speed (specs/surge.md). We spawn
// one of each at wave 1 (no HP scaling yet) and read its base HP and speed back.

import { newGame, spawn, unit } from "../_helpers.mjs";

const EXPECTED = {
  mote: { hp: 40, speed: 60 },
  sprint: { hp: 24, speed: 120 },
  hulk: { hp: 220, speed: 38 },
  swarm: { hp: 12, speed: 70 },
  drift: { hp: 60, speed: 80 },
  core: { hp: 1600, speed: 30 },
};

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.stats");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 1000000);
  for (const [type, want] of Object.entries(EXPECTED)) {
    const id = await spawn(api, type, "left");
    const u = await unit(api, id);
    check.expectClose(`${type} base HP`, u.maxHp, want.hp, 0.5);
    check.expectClose(`${type} base speed`, u.baseSpeed, want.speed, 0.5);
  }

  await api.wait(80);
  await api.screenshot("stats");
  return check.verdict();
}
