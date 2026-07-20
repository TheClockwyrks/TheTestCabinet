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

export default function item() {
  const got = {};

  return {
    id: "surge.stats",

    // Wave 1, so no HP scaling has been applied yet and the numbers read back are the
    // base stats. Lives are posed high because every one of these will walk off.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
    },

    // Spawn one of each type and read its stats straight off the unit.
    async act(api) {
      for (const type of Object.keys(EXPECTED)) {
        const id = await spawn(api, type, "left");
        const u = await unit(api, id);
        got[type] = { hp: u.maxHp, speed: u.baseSpeed };
      }
      await api.settle(80);
      await api.screenshot("stats");
    },

    async assert(api, check) {
      for (const [type, want] of Object.entries(EXPECTED)) {
        check.expectClose(`${type} base HP`, got[type].hp, want.hp, 0.5);
        check.expectClose(
          `${type} base speed`,
          got[type].speed,
          want.speed,
          0.5,
        );
      }
    },
  };
}
