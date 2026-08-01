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
    //
    // The tower is SELECTED for the still. The two figures this item asserts on are
    // both on screen in the selected-tower inspector — "the tower's current per-shot
    // damage together with its heat damage multiplier ... for example `42 (x3.5 heat)`"
    // (specs/controls.md) — and unselected they are nowhere, leaving a screenshot of a
    // dim 2x2 block on an empty floor as the entire evidence for a claim about two
    // numbers. The shop hover is cleared first because a hovered type's info panel
    // occupies that same area "in place of" the inspector (specs/controls.md), and
    // laying out the floor leaves a placement armed.
    async act(api) {
      t = await tower(api, towerId);
      await api.call("hoverShop", null);
      await api.call("selectTower", towerId);
      await api.settle(80);
      await api.screenshot("cold");
    },

    async assert(api, check) {
      // Hard: the reads below are off the tower, so a soft guard would let the script
      // throw on a null and be recorded as a debug-API failure rather than as this
      // check's own verdict.
      check.assertOk("the emitter placed", t !== null);
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
