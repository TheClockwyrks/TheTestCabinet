// State: the campaign-victory screen is reachable after the final level. The finale's quota
// is pre-satisfied and its clock run out, so winning the last level rolls into victory.

import { startFresh, arrangePrimeQuota, actLatchQuota } from "../_helpers.mjs";

export default function item() {
  // The screen clearing the final level reached.
  let screen;

  return {
    id: "states.victory",

    // Pose the finale's quota counters. The quota-satisfied latch is a real rule that
    // resolves on the next simulation step, so it belongs in `act`.
    async arrange(api) {
      await startFresh(api, 6);
      await arrangePrimeQuota(api, {
        delivered: { red: 1, green: 2, blue: 3 },
        uniques: ["u-green", "u-red", "u-blue"],
      });
    },

    async act(api) {
      // One step for the quota-satisfied latch. Level 6 has a last train, so this latches
      // `quotaMet` without winning outright — the clock running out is what wins it.
      await actLatchQuota(api);

      await api.call("setClock", 1); // seconds: `setClock` poses the clock, it does not advance it
      await api.advance(90); // 90 ticks = the old 1.5s, past the 1 s left — win the final level

      await api.settle(150); // let the victory screen paint before capturing it
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq(
        "clearing the final level reaches victory",
        screen,
        "victory",
      );
    },
  };
}
