// Automated validation for towers.auto-fire: a firing component fires automatically at a
// valid in-range unit with no manual trigger, and the unit takes HP loss.
//
// Arming the component and releasing the Slug are control ops (the arrange). Nothing else is
// done to the tower at all — which is the point — so the act is purely waiting, and the clip is
// a tower opening fire on its own.

import { armTower, spawnControlled, unitById, snap, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The unit followed, its pre-shot HP, whether it was hit, and its HP after.
  let u;
  let fired;
  let hpAfter;

  return {
    id: "towers.auto-fire",

    async arrange(api) {
      await armTower(api, { type: "capacitor", tier: 1 });
      [u] = await spawnControlled(api, "slug"); // high HP: survives to be read
    },

    async act(api) {
      const hp0 = u.hp;
      // 0.5 s = 30 ticks, polled a tick at a time: the instant the HP drops is what is read.
      fired = await api.until(
        (s) => {
          const l = unitById(s, u.id);
          return l && l.hp < hp0;
        },
        { max: 0.5 * SECOND, poll: TICK },
      );
      hpAfter = unitById(await snap(api), u.id).hp;
    },

    async assert(api, check) {
      check.expectOk("the component fired on its own and damaged the in-range unit", fired.hit);
      check.expectLt("the unit lost HP with no manual trigger", hpAfter, u.hp);
    },
  };
}
