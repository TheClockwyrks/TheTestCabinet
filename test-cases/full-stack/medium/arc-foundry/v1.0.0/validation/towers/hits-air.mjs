// Automated validation for towers.hits-air: a firing component in range hits the airborne
// Filament flyer as readily as a ground unit.
//
// Arming the component and releasing the flyer are control ops (the arrange); waiting for the
// shot that connects with an airborne target is the behavior under test and is the act.

import { armTower, spawnControlled, unitById, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The flyer followed, and whether it was ever hit.
  let f;
  let hit;

  return {
    id: "towers.hits-air",

    async arrange(api) {
      await armTower(api, { type: "capacitor", tier: 1 });
      [f] = await spawnControlled(api, "filament");
    },

    async act(api) {
      const hp0 = f.hp;
      // 0.5 s = 30 ticks, polled a tick at a time: the instant the HP drops is what is read.
      hit = await api.until(
        (s) => {
          const l = unitById(s, f.id);
          return l && l.hp < hp0;
        },
        { max: 0.5 * SECOND, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk("the target is airborne", f.flying === true);
      check.expectOk("the component hit the airborne Filament", hit.hit);
    },
  };
}
