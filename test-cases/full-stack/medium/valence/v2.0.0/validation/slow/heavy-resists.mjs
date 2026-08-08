// Automated validation for the Slow sub-item `heavy-resists`.
//
// A heavy in a Moderator field is slowed only partially — it resists to a higher speed than
// ordinary matter does (specs/towers.md: "A heavy resists, slowed only to `×0.78`"). The
// heavy is posed outside the field and walks in, so the resist is read as a change rather
// than as a number on an already-affected unit; see the aura-crossing note in
// `_helpers.mjs`.

import {
  arrangeAuraApproach,
  actAuraCrossing,
  auraClipMs,
} from "../_helpers.mjs";

const HEAVY_RESIST = 0.78;
const ORDINARY_SLOW = 0.55;

export default function item() {
  let ctx;
  let crossing;

  return {
    id: "slow.heavy-resists",

    clipMs: auraClipMs(),

    async arrange(api) {
      ctx = await arrangeAuraApproach(api, {
        kind: "moderator",
        type: "isotope",
      });
    },

    // The heavy pushing through the field at a speed the aura barely dents.
    async act(api) {
      crossing = await actAuraCrossing(api, ctx);
    },

    async assert(api, check) {
      check.expectEq(
        "the heavy is unslowed outside the field (factor 1)",
        ctx.outside.slow,
        1,
      );
      check.expectOk(
        "the heavy reached the Moderator's field",
        crossing.entered,
      );
      check.expectClose(
        "a heavy resists the slow (~0.78x)",
        crossing.inside ? crossing.inside.slow : 1,
        HEAVY_RESIST,
        0.04,
      );
      check.expectGt(
        "a heavy is slowed less than ordinary matter (which is ~0.55x)",
        crossing.inside ? crossing.inside.slow : 0,
        ORDINARY_SLOW,
      );
    },
  };
}
