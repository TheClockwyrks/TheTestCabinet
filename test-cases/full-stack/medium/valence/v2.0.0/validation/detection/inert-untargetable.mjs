// Automated validation for the Detection sub-item `inert-untargetable`.
//
// Inert matter is untargetable until a detector reveals it. The check poses an inert
// Noble under an Emitter (no detector present), runs the real sim, and confirms the
// noble stays unrevealed and untouched and the tower never acquires it.

import { coverAndSpawn, unitById, towerById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let towerId;
  let hp0;
  let now;

  return {
    id: "detection.inert-untargetable",

    async arrange(api) {
      ({ unitId, towerId } = await coverAndSpawn(api, {
        kind: "emitter",
        type: "noble",
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // The noble walking straight through the emitter's range untouched — which is the
    // behavior, and reads on the clip as a tower conspicuously not firing.
    async act(api) {
      // 120 ticks = the old 2 s.
      await api.advance(120);
      now = await api.snapshot();
    },

    async assert(api, check) {
      const u = unitById(now, unitId);
      check.expectOk("the inert unit is still alive", u != null);
      check.expectEq("the inert unit is unrevealed", u.revealed, false);
      check.expectEq(
        "an undetected inert unit is untouched (hp unchanged)",
        u.hp,
        hp0,
      );
      check.expectEq(
        "the tower never targets the undetected inert unit",
        towerById(now, towerId).targetId,
        null,
      );
    },
  };
}
