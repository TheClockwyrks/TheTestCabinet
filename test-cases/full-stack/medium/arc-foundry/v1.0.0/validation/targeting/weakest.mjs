// Automated validation for targeting.weakest: under `weakest` a firing component aims at the
// unit with the least remaining HP.
//
// A high-HP Slug and a low-HP Cluster are colocated; the single-target Emitter's first shot
// must land on the Cluster and leave the Slug untouched.
//
// Both units are released on the SAME tick, so the whole board — including the targeting mode —
// is arrangeable; only waiting for the first shot consumes time, and that is the act.

import { arrangeHpTargets, actHpTargets } from "../_helpers.mjs";

export default function item() {
  // The ids the act needs, and the shot it produced.
  let ctx;
  let shot;

  return {
    id: "targeting.weakest",

    async arrange(api) {
      ctx = await arrangeHpTargets(api, "weakest");
    },

    async act(api) {
      shot = await actHpTargets(api, ctx);
    },

    async assert(api, check) {
      const { strong, weak, strongHp0, weakHp0 } = shot;
      check.expectGt("the pose really does differ in HP", strongHp0, weakHp0);
      check.expectLt("the weakest (lowest-HP) unit was hit", weak.hp, weakHp0);
      check.expectEq("...and the stronger unit was not", strong.hp, strongHp0);
    },
  };
}
