// Automated validation for the Detection sub-item `catalyst-excite`.
//
// Matter in a Catalyst's field is excited — it takes extra damage per hit while in the
// aura. The check poses an atom in a Catalyst's field, advances briefly for the aura to
// apply, and reads the unit's positive `damageBonus`.

import { coverAndSpawn, unitById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let u;

  return {
    id: "detection.catalyst-excite",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "catalyst",
        type: "atom",
        electrons: 4,
      }));
    },

    // The atom sitting in the aura, which is the whole scenario the check is about.
    async act(api) {
      // 3 ticks = the old 0.05 s: enough for the aura to have applied.
      await api.advance(3);
      u = unitById(await api.snapshot(), unitId);
    },

    async assert(api, check) {
      check.expectGe(
        "matter in a Catalyst field is excited (+damage per hit)",
        u.damageBonus,
        1,
      );
    },
  };
}
