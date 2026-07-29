// Automated validation for abilities.slow: a Choke hit scales the struck unit's speed by
// (1 - amt) for a duration; only its speed changes.
//
// Arming the Choke and releasing the Slug are instant (the arrange); waiting for the hit that
// slows it is the behavior under test, so it is the act and is what the clip shows.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Choke cadences (1.3 shots/s), so a build that opens on a full cooldown still lands
// its first hit inside the budget.
const SLOW_TICKS = 4 * SECOND;
// A T1 Choke's slow lasts 1.2 s. Filming most of it is the point of this item's clip: the
// measurement is over the instant the slow lands, but a reviewer can only SEE a slow by
// watching the unit crawl and then pick its pace back up, so the clip runs past the expiry.
const WATCH_TICKS = 2.5 * SECOND;

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
      await skipToApproach(api, towerId, unitId);
    },

    async act(api) {
      // Polled a tick at a time: the instant the slow lands is what is read.
      slowed = await api.until(
        (st) => {
          const live = unitById(st, unitId);
          return live && live.slowFactor < 1;
        },
        { max: SLOW_TICKS, poll: TICK },
      );
      s = await snap(api);
      l = unitById(s, unitId);

      // The assertions are already fixed on `l`; this only lets the clip run long enough to
      // watch the Slug crawl under the slow.
      await api.advance(WATCH_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Choke slowed the struck unit", slowed.hit);
      check.expectClose("the slow factor is 1 - slowAmt (T1 Choke = 0.78)", l.slowFactor, 0.78, 0.01);
      check.expectClose("the effective speed is base x slowFactor", l.speed, l.baseSpeed * l.slowFactor, 0.6);
      check.expectGt("the slow has a live duration", l.slowUntil, s.simTime);
    },
  };
}
