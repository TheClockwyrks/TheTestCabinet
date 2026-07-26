// Automated validation for the Slow sub-item `boss-immune`.
//
// The Macromass boss is immune to the Moderator slow — its speed is unchanged in the
// field. The check poses the boss in a Moderator's field, advances briefly, and confirms
// its slow factor is 1 and its speed equals its base speed.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let u;

  return {
    id: "slow.boss-immune",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "moderator",
        type: "macromass",
      }));
    },

    // The boss walking through the field at full pace — the point being that the aura
    // visibly does nothing to it.
    async act(api) {
      // 3 ticks = the old 0.05 s: enough for the aura to have applied.
      await api.advance(3);
      u = unitById(await api.snapshot(), unitId);
    },

    async assert(api, check) {
      check.expectEq("the boss is immune to the slow (factor 1)", u.slow, 1);
      check.expectEq("its speed is its full base speed", u.speed, u.baseSpeed);
    },
  };
}
