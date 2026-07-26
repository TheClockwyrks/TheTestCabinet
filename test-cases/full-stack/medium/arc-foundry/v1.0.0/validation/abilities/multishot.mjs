// Automated validation for abilities.multishot: a multishot combination tower fires at up to N
// distinct in-range targets per cadence, each a separate traveling projectile.
//
// A Fork Array (multishot 3) is assembled and three units released; in its first volley there
// must be projectiles homing on at least two distinct targets at once.
//
// Assembling the combo and releasing the pack are control ops (the arrange); the volley itself
// is what consumes time, so it is the act and is what the clip shows.

import { assembleCombo, spawnControlled, snap, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The assembled combo, whether a multi-target volley was seen, and the volley snapshot.
  let comboId;
  let volley;
  let s;

  return {
    id: "abilities.multishot",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "forkarray", { seed: 1, charge: 400 }));
      await spawnControlled(api, "mote", { count: 3 });
    },

    async act(api) {
      // 0.5 s = 30 ticks, read every tick — a volley is in flight only briefly.
      volley = await api.until((st) => new Set(st.projectiles.map((p) => p.targetId)).size >= 2, {
        max: 0.5 * SECOND,
        poll: TICK,
      });
      s = await snap(api);
    },

    async assert(api, check) {
      check.expectOk("a Fork Array was assembled", comboId != null);
      check.expectOk("the multishot combo fired at multiple distinct targets at once", volley.hit);
      check.expectGe(
        "multiple distinct targets were engaged in one cadence",
        new Set(s.projectiles.map((p) => p.targetId)).size,
        2,
      );
    },
  };
}
