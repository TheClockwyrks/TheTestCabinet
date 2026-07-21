// Automated validation for the Economy sub-item `sell-full-opening`.
//
// A tower placed and sold during the untimed opening build phase (before round one)
// refunds its full cost. The check places an Emitter in the opening phase and sells it,
// confirming the refund equals the full spend.

import { startRun, pathGeom, placeCovering, MAP } from "../_helpers.mjs";

export default function item() {
  let phase0;
  let t;
  let spent;
  let refund;

  return {
    id: "economy.sell-full-opening",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: 100000 });
      phase0 = snap.phase;
      const g = pathGeom(snap.paths[0]);
      t = await placeCovering(api, "emitter", g, g.length * 0.3);
      spent = (await api.snapshot()).towers.find((x) => x.id === t.id).spent;
    },

    // The sale itself — the behavior under test. `settle` is a real repaint pause in both
    // passes, so the still shows the board after the refund rather than mid-update.
    async act(api) {
      refund = await api.call("sellTower", t.id);
      await api.settle(150);
      await api.screenshot("sell");
    },

    async assert(api, check) {
      check.expectEq("the opening phase is the build phase", phase0, "build");
      check.expectEq(
        "a sell in the opening phase refunds in full",
        refund,
        spent,
      );
    },
  };
}
