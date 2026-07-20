// Automated validation for the Flyers sub-item `any-emitter-hits`.
//
// Any emitter can damage a flyer in range — the Flak is the dedicated air specialist,
// not the only counter (specs/towers.md). We place a plain Arc on the flight line,
// spawn a real Drift, and confirm the Arc damages it.

import { newGame, build, spawn, TICK } from "../_helpers.mjs";

export default function item() {
  let driftId;
  let r;

  return {
    id: "flyers.any-emitter-hits",

    // A plain Arc — not a Flak — sitting on the flight line, hot enough to do real
    // damage, with a real Drift flying into its range.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const arc = await build(api, "arc", 10, 17);
      await api.call("setHeat", arc, 80); // fire at real damage
      driftId = await spawn(api, "drift", "left");
    },

    // 360 ticks = the old 6s cap; polling every tick catches the first hit rather
    // than a state several shots later.
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === driftId && u.hp < u.maxHp),
        { max: 360, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk("a plain Arc damaged the flyer in range", r.hit);
    },
  };
}
