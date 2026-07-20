// Automated validation for economy.value-rises-depth.
//
// A deep ore sells for many times a shallow one. We sell one unit of the shallowest ore and one of
// the deepest, reading the Credits each fetches through the real market path.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let shallow;
  let deep;

  return {
    id: "economy.value-rises-depth",

    async arrange(api) {
      await newRun(api);
    },

    // Both sales run here — they are the behavior under test, and the clip shows the two very
    // different payouts land back to back.
    async act(api) {
      const c0 = (await api.snapshot()).credits;
      await api.call("addCargo", "ferron", 1); // shallowest ore
      await api.call("sell");
      shallow = (await api.snapshot()).credits - c0;

      const c1 = (await api.snapshot()).credits;
      await api.call("addCargo", "adamite", 1); // deepest ore
      await api.call("sell");
      deep = (await api.snapshot()).credits - c1;

      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip tail
    },

    async assert(api, check) {
      check.expectGt("a shallow ore is worth a little", shallow, 0);
      check.expectGt("a deep ore is worth far more", deep, shallow * 10);
    },
  };
}
