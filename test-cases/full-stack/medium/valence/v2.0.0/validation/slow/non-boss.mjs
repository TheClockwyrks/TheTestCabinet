// Automated validation for the Slow sub-item `non-boss`.
//
// A Moderator's aura slows ordinary matter to a fraction of its unslowed speed
// (specs/towers.md: "slows every non-boss unit in its field to `×0.55` speed"). The atom is
// posed OUTSIDE the field and walks in, so the check reads its speed on both sides of the
// boundary — see the aura-crossing note in `_helpers.mjs` for why that matters both to the
// clip and to the verdict.

import {
  arrangeAuraApproach,
  actAuraCrossing,
  auraClipMs,
} from "../_helpers.mjs";

const SLOW_FACTOR = 0.55;

export default function item() {
  let ctx;
  let crossing;

  return {
    id: "slow.non-boss",

    clipMs: auraClipMs(),

    async arrange(api) {
      ctx = await arrangeAuraApproach(api, {
        kind: "moderator",
        type: "atom",
        electrons: 3,
      });
    },

    // The atom crossing into the field and visibly dropping to a crawl.
    async act(api) {
      crossing = await actAuraCrossing(api, ctx);
    },

    async assert(api, check) {
      check.expectEq(
        "the atom is unslowed outside the field (factor 1)",
        ctx.outside.slow,
        1,
      );
      check.expectOk(
        "the atom reached the Moderator's field",
        crossing.entered,
      );
      check.expectClose(
        "a Moderator slows ordinary matter to ~0.55x",
        crossing.inside ? crossing.inside.slow : 1,
        SLOW_FACTOR,
        0.03,
      );
      check.expectClose(
        "its current speed is its base speed slowed",
        crossing.inside ? crossing.inside.speed : 0,
        ctx.outside.baseSpeed * SLOW_FACTOR,
        ctx.outside.baseSpeed * 0.06,
      );
    },
  };
}
