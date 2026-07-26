// Automated validation for the Economy sub-item `interest`.
//
// Between waves the player earns interest on their savings, capped, in the modes that
// grant it (specs/economy.md — 8% up to a cap of 40). In Containment from 500 money
// with no towers, clearing wave 1 pays the wave bonus (25) plus the capped interest
// (40) — a total of 565.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let r;
  let money;

  return {
    id: "economy.interest",

    // 500 saved is well above the point where 8% hits the 40 cap, so the check reads
    // the cap rather than a percentage. Nothing is built, so the whole wave leaks and
    // no bounty can muddy the payout.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1000000);
      await api.call("setMoney", 500);
      await api.call("startWave");
    },

    // Run wave 1 to its clear and the payout that follows. 2400 ticks = the old 40s
    // cap, polled every 12 ticks (the old 0.2s chunk).
    async act(api) {
      r = await api.until((s) => s.money > 500 && s.wave >= 2, {
        max: 2400,
        poll: 12,
      });
      money = (await api.snapshot()).money;
    },

    async assert(api, check) {
      check.expectOk("wave 1 cleared into the next build phase", r.hit);
      // 500 + wave-1 bonus (25) + capped interest (40) = 565.
      check.expectEq("interest (40) is paid on top of the bonus", money, 565);
    },
  };
}
