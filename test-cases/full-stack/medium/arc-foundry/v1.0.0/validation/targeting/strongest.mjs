// Automated validation for targeting.strongest: under `strongest` a firing component aims at
// the unit with the most remaining HP.
//
// Two identical Slugs walk the corridor a beat apart and the LEADER is wounded outright, off
// camera, before the priority under test is armed — so the strong one is the trailing unit,
// which is neither the furthest along nor the nearest, and a build that confuses `strongest` with
// `first` or `nearest` reaches for the wrong one. Once both are inside the tower's reach the
// damage must land on the high-HP unit.
//
// WHY THE PAIR IS IDENTICAL AND ONE OF THEM IS WOUNDED. The two units used to be separated by
// scaling them to different waves, which gives them different HP and different MAXIMUM HP. The
// check could read that difference; a reviewer could not see it, because an HP bar is a fraction
// of a unit's own maximum and two units at full health both draw a full bar however far apart
// their totals are — so the clip showed two apparently identical units and a tower choosing
// between them for invisible reasons. Identical units at one wave scaling share a maximum, so
// wounding one makes the difference a difference in the bar.
//
// The wound is posed with `setUnitHp` (`specs/instrumentation.md`) rather than shot in. Shooting
// it in meant aiming the tower with some other priority to grade this one, which left the item
// ungradeable against a build whose aiming was itself broken. See `arrangeHpTargets` in
// `_helpers.mjs`.
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
