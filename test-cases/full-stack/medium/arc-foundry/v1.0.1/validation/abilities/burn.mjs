// Automated validation for abilities.burn: a Rectifier hit lights an overcurrent burn — a
// damage-over-time that keeps ticking HP loss after the shot lands, for a duration.
//
// Arming the Rectifier and releasing the Slug are instant, so they are the arrange. Waiting for
// the burn to light and then watching it eat HP with no further shot is the behavior under
// test, so it is the act and is what the clip shows.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Rectifier cadences (1.1 shots/s), so a build that opens on a full cooldown still
// lands its first hit inside the budget.
const LIGHT_TICKS = 4 * SECOND;
// A T1 Rectifier's burn runs 2 s. The measurement only needs to see HP fall with no further
// shot, but a reviewer can only SEE a burn by watching it eat away at the unit, so the clip
// carries the whole of it.
const WATCH_TICKS = 2.5 * SECOND;

export default function item() {
  // The unit `act` follows, whether a burn was ever lit, the state at that instant, and the HP
  // a further 0.6 s of burning left behind — all read by `assert`.
  let unitId;
  let lit;
  let s;
  let l;
  let hpAfterHit;
  let hpLater;

  return {
    id: "abilities.burn",

    async arrange(api) {
      const towerId = await armTower(api, { type: "rectifier", tier: 1 });
      await api.call("setTargeting", towerId, "strongest");
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
      await skipToApproach(api, towerId, unitId);
    },

    async act(api) {
      // Polled a tick at a time: the instant the burn lights is what is read.
      lit = await api.until(
        (st) => {
          const live = unitById(st, unitId);
          return live && live.burnDps > 0;
        },
        { max: LIGHT_TICKS, poll: TICK },
      );

      s = await snap(api);
      l = unitById(s, unitId);
      hpAfterHit = l.hp;

      // The burn alone must keep eating HP after the shot landed — and running the whole burn
      // duration, rather than a fraction of it, is what makes the clip legible.
      await api.advance(WATCH_TICKS);
      hpLater = unitById(await snap(api), unitId)?.hp ?? hpAfterHit;
    },

    async assert(api, check) {
      check.expectOk("the Rectifier lit a burn", lit.hit);
      check.expectClose("burnDps is shotDamage x burnFrac (2 x 0.5 = 1)", l.burnDps, 1, 0.01);
      check.expectGt("the burn has a live duration", l.burnUntil, s.simTime);
      check.expectLt("the burn keeps ticking HP loss after the shot", hpLater, hpAfterHit);
    },
  };
}
