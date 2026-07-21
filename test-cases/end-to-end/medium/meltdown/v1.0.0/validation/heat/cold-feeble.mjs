// Automated validation for the Heat sub-item `cold-feeble`.
//
// A cold emitter fires at about 0.35x base damage (specs/heat.md). Heat is posed to
// 0 as a precondition; the live heat damage multiplier and per-shot damage the game
// reports are computed by the real damage curve, which we read back.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let towerId;
  let t;

  return {
    id: "heat.cold-feeble",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "arc", 6, 20);
      await api.call("setHeat", towerId, 0);
    },

    // Read the real curve's output for a cold emitter, then let a frame land so the
    // still shows the tower drawn cold.
    async act(api) {
      t = await tower(api, towerId);
      await api.settle(80);
      await api.screenshot("cold");
    },

    async assert(api, check) {
      check.expectOk("the emitter placed", t !== null);
      check.expectClose(
        "a cold emitter's heat multiplier (~0.35x)",
        t.heatMult,
        0.35,
        0.02,
      );
      // Arc base damage is 6 (specs/towers.md), so a cold shot does ~2.1.
      check.expectClose(
        "a cold emitter's per-shot damage (~0.35x base)",
        t.damage,
        6 * 0.35,
        0.2,
      );
    },
  };
}
