// Automated validation for the Economy sub-item `interest`.
//
// Between waves the player earns interest on their savings, capped, in the modes that
// grant it (specs/economy.md — 8% up to a cap of 40). In Containment from 500 money
// with no towers, clearing wave 1 pays the wave bonus (25) plus the capped interest
// (40) — a total of 565.

import { newGame, actTail, nearlyOut } from "../_helpers.mjs";

export default function item() {
  let r;
  let money;

  return {
    id: "economy.interest",

    // As `wave-clear-bonus`: the wave is skipped to its final approach and only the
    // payout is filmed.
    clipMs: 5000,

    // 500 saved is well above the point where 8% hits the 40 cap, so the check reads
    // the cap rather than a percentage. Nothing is built, so the whole wave leaks and
    // no bounty can muddy the payout.
    //
    // Interest is paid BETWEEN waves, so wave 1 has to run out before there is
    // anything to see — and on an undefended floor that is most of a minute of Motes
    // walking, none of which is the claim. It is run through unfilmed as far as the
    // last unit's final approach; `act` is the clear and the balance stepping from 500
    // to 565. 2400 ticks = the old 40s cap, kept as the skip's ceiling.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1000000);
      await api.call("setMoney", 500);
      await api.call("startWave");
      await api.skipUntil(
        (s) =>
          (s.money > 500 && s.wave >= 2) ||
          (s.waveRemaining <= 1 && s.surge.every(nearlyOut)),
        { max: 2400, poll: 12 },
      );
    },

    // 600 ticks = 10s: only the last unit's approach and the payout remain.
    async act(api) {
      r = await api.until((s) => s.money > 500 && s.wave >= 2, {
        max: 600,
        poll: 6,
      });
      money = (await api.snapshot()).money;
      await actTail(api, 120); // 2 s on the 565 balance in the new build phase
    },

    async assert(api, check) {
      check.expectOk("wave 1 cleared into the next build phase", r.hit);
      // 500 + wave-1 bonus (25) + capped interest (40) = 565.
      check.expectEq("interest (40) is paid on top of the bonus", money, 565);
    },
  };
}
