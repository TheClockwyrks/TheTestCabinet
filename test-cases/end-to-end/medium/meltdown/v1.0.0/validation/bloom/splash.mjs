// Automated validation for the Bloom sub-item `splash`.
//
// A Bloom shot damages every unit within its splash radius of the impact
// (specs/towers.md), so one shot into a clump hits several units at once. We place a
// Bloom by the lane, spawn a tight clump of real Motes, and confirm more than one is
// damaged.

import { newGame, build, spawn, TICK } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "bloom.splash",

    // A Bloom beside the lane at moderate power, with a tight clump of real Motes
    // walking into its range.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const bloom = await build(api, "bloom", 5, 20);
      await api.call("setHeat", bloom, 40); // moderate power: hits, but does not one-shot Motes
      for (let i = 0; i < 4; i += 1) await spawn(api, "mote", "left");
    },

    // Run the real firing/splash systems until a single shot has damaged two units.
    // 300 ticks = the old 5s cap; polling every tick catches the instant the splash
    // lands rather than a state several shots later.
    async act(api) {
      r = await api.until(
        (s) => s.surge.filter((u) => u.hp < u.maxHp).length >= 2,
        { max: 300, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk(
        "one Bloom shot damaged more than one unit in the clump",
        r.hit,
      );
    },
  };
}
