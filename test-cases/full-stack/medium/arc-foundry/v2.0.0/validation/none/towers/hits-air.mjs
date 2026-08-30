// Automated validation for towers.hits-air: a firing component in range hits the airborne
// Filament flyer as readily as a ground unit.
//
// Arming the component and releasing the flyer are control ops (the arrange); waiting for the
// shot that connects with an airborne target is the behavior under test and is the act.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Capacitor cadences, so a build that opens a component on a full cooldown still
// resolves inside the budget.
const FIRE_TICKS = 4 * SECOND;
// A beat after the hit, so the clip carries the flyer being knocked rather than cutting on it.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The flyer followed, and whether it was ever hit.
  let f;
  let hit;

  return {
    id: "towers.hits-air",

    async arrange(api) {
      const towerId = await armTower(api, { type: "capacitor", tier: 1 });
      [f] = await spawnControlled(api, "filament");
      await skipToApproach(api, towerId, f.id);
    },

    async act(api) {
      const hp0 = f.hp;
      // Polled a tick at a time: the instant the HP drops is what is read.
      hit = await api.until(
        (s) => {
          const l = unitById(s, f.id);
          return l && l.hp < hp0;
        },
        { max: FIRE_TICKS, poll: TICK },
      );

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the target is airborne", f.flying === true);
      check.expectOk("the component hit the airborne Filament", hit.hit);
    },
  };
}
