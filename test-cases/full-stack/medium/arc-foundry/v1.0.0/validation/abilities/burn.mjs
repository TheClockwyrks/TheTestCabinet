// Automated validation for abilities.burn: a Rectifier hit lights an overcurrent burn — a
// damage-over-time that keeps ticking HP loss after the shot lands, for a duration.
//
// Arming the Rectifier and releasing the Slug are instant, so they are the arrange. Waiting for
// the burn to light and then watching it eat HP with no further shot is the behavior under
// test, so it is the act and is what the clip shows.

import { armTower, spawnControlled, unitById, snap, TICK, SECOND } from "../_helpers.mjs";

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
    },

    async act(api) {
      // 0.6 s = 36 ticks, polled a tick at a time: the instant the burn lights is what is read.
      lit = await api.until(
        (st) => {
          const live = unitById(st, unitId);
          return live && live.burnDps > 0;
        },
        { max: 0.6 * SECOND, poll: TICK },
      );

      s = await snap(api);
      l = unitById(s, unitId);
      hpAfterHit = l.hp;

      // Another 0.6 s (36 ticks): the burn alone must keep eating HP after the shot landed.
      await api.advance(0.6 * SECOND);
      hpLater = unitById(await snap(api), unitId).hp;
    },

    async assert(api, check) {
      check.expectOk("the Rectifier lit a burn", lit.hit);
      check.expectClose("burnDps is shotDamage x burnFrac (2 x 0.5 = 1)", l.burnDps, 1, 0.01);
      check.expectGt("the burn has a live duration", l.burnUntil, s.simTime);
      check.expectLt("the burn keeps ticking HP loss after the shot", hpLater, hpAfterHit);
    },
  };
}
