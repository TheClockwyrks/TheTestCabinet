// Automated validation for the Slow sub-item `boss-immune`.
//
// The Macromass boss is immune to the Moderator slow (specs/matter.md: "It is immune to
// being slowed by a Moderator"), so its speed is unchanged in the field.
//
// This is the item that decides how an aura crossing waits. Keying the wait on "the effect
// changed" would hang here forever and time out against a CONFORMANT build, because nothing
// changing is the whole requirement. `actAuraCrossing` waits on GEOMETRY instead — the
// boss's distance from the tower against that tower's radius — which is exactly the claim
// this item has to establish before its reading means anything: the boss was genuinely
// inside the field, and was not slowed anyway.

import {
  arrangeAuraApproach,
  actAuraCrossing,
  auraClipMs,
} from "../_helpers.mjs";

export default function item() {
  let ctx;
  let crossing;

  return {
    id: "slow.boss-immune",

    clipMs: auraClipMs(),

    async arrange(api) {
      ctx = await arrangeAuraApproach(api, {
        kind: "moderator",
        type: "macromass",
      });
    },

    // The boss walking into the field and straight through it at full pace — the point
    // being that the aura visibly does nothing to it.
    async act(api) {
      crossing = await actAuraCrossing(api, ctx);
    },

    async assert(api, check) {
      check.expectOk(
        "the boss reached the Moderator's field",
        crossing.entered,
      );
      check.expectEq(
        "the boss is immune to the slow (factor 1)",
        crossing.inside ? crossing.inside.slow : null,
        1,
      );
      check.expectEq(
        "its speed inside the field is its full base speed",
        crossing.inside ? crossing.inside.speed : null,
        ctx.outside.baseSpeed,
      );
    },
  };
}
