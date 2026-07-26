// Automated validation for targeting.last: under `last` a firing component aims at the unit
// least far along the chain (the fresh one), not the advanced one.
//
// The pose is split across the seam: `arrangeHeadTargets` arms the Emitter and releases the
// first unit (instant), and `actHeadTargets` is the act, because the two units only come to
// differ once game time passes between their releases. The mode is applied in the act half for
// the same reason — the `setTargeting` happens after that gap has opened.

import { arrangeHeadTargets, actHeadTargets, angleTo, angDiff } from "../_helpers.mjs";

export default function item() {
  // The ids the act needs, and the pose it produced.
  let ctx;
  let posed;

  return {
    id: "targeting.last",

    async arrange(api) {
      ctx = await arrangeHeadTargets(api);
    },

    async act(api) {
      posed = await actHeadTargets(api, ctx, "last");
    },

    async assert(api, check) {
      const { t, la, lb } = posed;
      const toAdvanced = angDiff(t.heading, angleTo(t.cx, t.cy, la));
      const toFresh = angDiff(t.heading, angleTo(t.cx, t.cy, lb));
      check.expectLt("under last, the head aims at the unit least far along (the fresh one)", toFresh, toAdvanced);
      check.expectLt("...and closely tracks it", toFresh, 0.25);
    },
  };
}
