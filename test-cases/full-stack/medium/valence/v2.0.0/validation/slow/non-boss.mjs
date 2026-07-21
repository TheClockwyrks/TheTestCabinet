// Automated validation for the Slow sub-item `non-boss`.
//
// A Moderator's aura slows ordinary matter to a fraction of its unslowed speed. The
// check poses an atom in a Moderator's field, advances briefly for the aura to apply, and
// reads the unit's slow factor and current speed.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let u;

  return {
    id: "slow.non-boss",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "moderator",
        type: "atom",
        electrons: 3,
      }));
    },

    // The atom crawling through the field — the behavior, and what the clip shows.
    async act(api) {
      // 3 ticks = the old 0.05 s: enough for the aura to have applied.
      await api.advance(3);
      u = unitById(await api.snapshot(), unitId);
    },

    async assert(api, check) {
      check.expectClose(
        "a Moderator slows ordinary matter to ~0.55x",
        u.slow,
        0.55,
        0.03,
      );
      check.expectClose(
        "its current speed is its base speed slowed",
        u.speed,
        u.baseSpeed * 0.55,
        u.baseSpeed * 0.06,
      );
    },
  };
}
