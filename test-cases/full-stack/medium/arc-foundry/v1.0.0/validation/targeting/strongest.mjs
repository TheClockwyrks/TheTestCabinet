// Automated validation for targeting.strongest: under `strongest` a firing component aims at
// the unit with the most remaining HP.
//
// Two Motes scaled to different waves walk the corridor a beat apart, with the LOW-HP one leading
// — so it is both further along the chain and nearer the tower, and a build that confuses
// `strongest` with `first` or `nearest` reaches for the wrong one. Once both are inside the
// single-target Emitter's reach the damage must land on the high-HP unit.
//
// The pair used to be released on the same tick, which tied progress and distance but left the
// two units exactly superimposed — one sprite in the clip, and a pose in which `first`, `nearest`
// and `strongest` all resolve to the same unit, so it could not tell them apart. See
// `arrangeHpTargets` in `_helpers.mjs`.
//
// Posing the board is the arrange; the choice the head makes once it has both units to choose
// between is the behavior under test, so it is the act and it is the clip.

import { arrangeHpTargets, actHpTargets } from "../_helpers.mjs";

export default function item() {
  // The ids the act needs, and how the shooting divided between the pair.
  let ctx;
  let shot;

  return {
    id: "targeting.strongest",

    async arrange(api) {
      ctx = await arrangeHpTargets(api, "strongest");
    },

    async act(api) {
      shot = await actHpTargets(api, ctx);
    },

    async assert(api, check) {
      const { strongHp0, weakHp0, bothInReach, firstHitWasPick, pickDamage, otherDamage } = shot;
      check.expectGt("the pose really does differ in HP", strongHp0, weakHp0);
      check.expectOk("both units were in reach together, so the priority had a choice", bothInReach);
      check.expectOk("the first shot of that choice hit the strongest (highest-HP) unit", firstHitWasPick);
      check.expectGt(
        "...and the tower kept favouring it over the nearer, further-along weaker unit",
        pickDamage,
        otherDamage,
      );
    },
  };
}
