// Automated validation for abilities.multishot: a multishot combination tower fires at up to N
// distinct in-range targets per cadence, each a separate traveling projectile.
//
// A Fork Array (multishot 3) is assembled and three units released; in its first volley there
// must be projectiles homing on at least two distinct targets at once.
//
// Assembling the combo and releasing the pack are control ops (the arrange); the volley itself
// is what consumes time, so it is the act and is what the clip shows.

import {
  assembleCombo,
  spawnControlled,
  skipToApproach,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Fork Array cadences, so a build that opens on a full cooldown still volleys inside
// the budget.
const VOLLEY_TICKS = 4 * SECOND;
// A volley is over in a moment, and the old clip stopped on the tick it was detected — before
// the projectiles had gone anywhere. Carrying on lets a reviewer watch the separate bolts fan
// out, cross to their different targets, and land.
const WATCH_TICKS = 3 * SECOND;

export default function item() {
  // The assembled combo, whether a multi-target volley was seen, and the volley snapshot.
  let comboId;
  let volley;
  let s;

  return {
    id: "abilities.multishot",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "forkarray", { seed: 1, charge: 400 }));
      const pack = await spawnControlled(api, "mote", { count: 3 });
      if (comboId != null && pack.length) await skipToApproach(api, comboId, pack[0].id);
    },

    async act(api) {
      // Read every tick — a volley is in flight only briefly.
      volley = await api.until((st) => new Set(st.projectiles.map((p) => p.targetId)).size >= 2, {
        max: VOLLEY_TICKS,
        poll: TICK,
      });
      s = await snap(api);

      // The assertions are already fixed on `s`; this only lets the clip show the fan-out land.
      await api.advance(WATCH_TICKS);
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
