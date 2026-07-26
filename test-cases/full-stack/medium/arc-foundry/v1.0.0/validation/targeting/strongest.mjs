// Automated validation for targeting.strongest: under `strongest` a firing component aims at
// the unit with the most remaining HP.
//
// A high-HP Slug and a low-HP Cluster are colocated (so only HP distinguishes them); the
// single-target Emitter's first shot must land on the Slug and leave the Cluster untouched.
//
// Both units are released on the SAME tick, so the whole board — including the targeting mode —
// is arrangeable; only waiting for the first shot consumes time, and that is the act. That also
// makes the clip precisely the thing under test: one shot, and which of two colocated units it
// picks.

import { arrangeHpTargets, actHpTargets } from "../_helpers.mjs";

export default function item() {
  // The ids the act needs, and the shot it produced.
  let ctx;
  let shot;

  return {
    id: "targeting.strongest",

    async arrange(api) {
      ctx = await arrangeHpTargets(api, "strongest");
    },

    async act(api) {
      shot = await actHpTargets(api, ctx);
    },

    async assert(api, check) {
      const { slug, cluster, slugHp0, clHp0 } = shot;
      check.expectLt("the strongest (highest-HP) unit was hit", slug.hp, slugHp0);
      check.expectEq("...and the weaker unit was not", cluster.hp, clHp0);
    },
  };
}
