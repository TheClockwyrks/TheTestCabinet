// Automated validation for abilities.slow: a Choke hit scales the struck unit's speed by
// (1 - amt) for a duration; only its speed changes.
//
// Arming the Choke and releasing the Slug are instant (the arrange); waiting for the hit that
// slows it is the behavior under test, so it is the act and is what the clip shows.

import { armTower, spawnControlled, unitById, snap, TICK, SECOND } from "../_helpers.mjs";

export default function item() {
  // The unit `act` follows, whether a slow ever landed, and the state at that instant.
  let unitId;
  let slowed;
  let s;
  let l;

  return {
    id: "abilities.slow",

    async arrange(api) {
      const towerId = await armTower(api, { type: "choke", tier: 1 });
      await api.call("setTargeting", towerId, "strongest"); // keep the Choke on the Slug
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
    },

    async act(api) {
      // 0.6 s = 36 ticks, polled a tick at a time: the instant the slow lands is what is read.
      slowed = await api.until(
        (st) => {
          const live = unitById(st, unitId);
          return live && live.slowFactor < 1;
        },
        { max: 0.6 * SECOND, poll: TICK },
      );
      s = await snap(api);
      l = unitById(s, unitId);
    },

    async assert(api, check) {
      check.expectOk("the Choke slowed the struck unit", slowed.hit);
      check.expectClose("the slow factor is 1 - slowAmt (T1 Choke = 0.78)", l.slowFactor, 0.78, 0.01);
      check.expectClose("the effective speed is base x slowFactor", l.speed, l.baseSpeed * l.slowFactor, 0.6);
      check.expectGt("the slow has a live duration", l.slowUntil, s.simTime);
    },
  };
}
