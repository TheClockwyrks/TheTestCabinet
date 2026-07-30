// Automated validation for the Heavies sub-item `energy-immune`.
//
// A heavy isotope is immune to energy damage: an energy tower cannot even target it, and
// its hit points stay untouched. The check poses a heavy under an Emitter (energy),
// runs the real sim, and confirms the heavy's hit points are unchanged and the tower
// never acquires it.

import { coverAndSpawn, unitById, towerById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let towerId;
  let hp0;
  let now;

  return {
    id: "heavies.energy-immune",

    async arrange(api) {
      ({ unitId, towerId } = await coverAndSpawn(api, {
        kind: "emitter",
        type: "isotope",
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // The heavy walking through the emitter's range untouched — which reads on the clip
    // as a tower conspicuously refusing to fire.
    async act(api) {
      // 120 ticks = the old 2 s.
      await api.advance(120);
      now = await api.snapshot();
    },

    async assert(api, check) {
      // A build whose energy tower wears the heavy down may have killed it outright, which
      // is the failure under test — so the reads are guarded. Dereferencing a dead unit threw
      // out of the item, and a throw is reported as a broken debug API, not as this failure.
      const u = unitById(now, unitId);
      check.expectOk("the heavy is still alive", u != null);
      check.expectEq(
        "an energy tower cannot damage a heavy (hp unchanged)",
        u ? u.hp : 0,
        hp0,
      );
      check.expectEq(
        "the energy tower never even targets the heavy",
        towerById(now, towerId).targetId,
        null,
      );
    },
  };
}
