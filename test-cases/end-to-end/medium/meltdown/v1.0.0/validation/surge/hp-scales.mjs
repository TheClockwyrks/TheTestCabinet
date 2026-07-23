// Automated validation for the Surge sub-item `hp-scales`.
//
// A unit's HP scales up with the wave number (specs/gameplay.md — +62% per wave over
// wave 1), so a deep-wave unit is far tankier. A Mote is 40 HP at wave 1; at wave 6
// it is 40 * (1 + 0.62*5) = 164. We spawn a Mote at wave 1 and at wave 6 and compare.

import { newGame, spawn, unit } from "../_helpers.mjs";

export default function item() {
  let w1;
  let w6;

  return {
    id: "surge.hp-scales",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
    },

    // The same unit type spawned at two wave numbers. `setWave` only poses the wave
    // counter, so no fresh match is needed between the two — the scaling is applied
    // at spawn.
    async act(api) {
      w1 = await unit(api, await spawn(api, "mote", "left"));

      await api.call("setWave", 6);
      w6 = await unit(api, await spawn(api, "mote", "left"));

      await api.settle(80);
      await api.screenshot("scale");
    },

    async assert(api, check) {
      check.expectClose("a wave-1 Mote has base HP (40)", w1.maxHp, 40, 0.5);
      check.expectClose(
        "a wave-6 Mote has scaled HP (164)",
        w6.maxHp,
        164,
        0.5,
      );
      check.expectGt("HP scales up with the wave", w6.maxHp, w1.maxHp);
    },
  };
}
