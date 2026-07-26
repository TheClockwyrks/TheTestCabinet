// Automated validation for the Slow sub-item `heavy-resists`.
//
// A heavy in a Moderator field is slowed only partially — it resists to a higher speed
// than ordinary matter does. The check poses a heavy in a Moderator's field, advances
// briefly, and confirms its slow factor is the heavy resist value and clearly above the
// ordinary slow.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let u;

  return {
    id: "slow.heavy-resists",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "moderator",
        type: "isotope",
      }));
    },

    // The heavy pushing through the field at a speed the aura barely dents.
    async act(api) {
      // 3 ticks = the old 0.05 s: enough for the aura to have applied.
      await api.advance(3);
      u = unitById(await api.snapshot(), unitId);
    },

    async assert(api, check) {
      check.expectClose(
        "a heavy resists the slow (~0.78x)",
        u.slow,
        0.78,
        0.04,
      );
      check.expectGt(
        "a heavy is slowed less than ordinary matter (which is ~0.55x)",
        u.slow,
        0.55,
      );
    },
  };
}
