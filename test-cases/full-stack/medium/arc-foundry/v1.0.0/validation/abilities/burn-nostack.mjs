// Automated validation for abilities.burn-nostack: repeated burns on one unit do not add up —
// the burn damage-per-second stays the strongest single value (refreshed on hit), not the sum.
//
// A single Rectifier hits the same Slug several times over two seconds; burnDps must stay ~1,
// not climb toward 2.
//
// Arming the tower and releasing the Slug are control ops (the arrange); the two seconds of
// repeated hits is the whole behavior under test, so it is the act and is what gets filmed.

import { armTower, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

export default function item() {
  // The unit `act` follows, and the Slug after the run of hits, read by `assert`.
  let unitId;
  let l;

  return {
    id: "abilities.burn-nostack",

    async arrange(api) {
      const towerId = await armTower(api, { type: "rectifier", tier: 1 });
      await api.call("setTargeting", towerId, "strongest");
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
    },

    async act(api) {
      await api.advance(2 * SECOND); // 120 ticks — several Rectifier hits
      l = unitById(await snap(api), unitId);
      await api.screenshot("nostack");
    },

    async assert(api, check) {
      check.expectOk("the Slug is still alive to read", !!l);
      check.expectClose("repeated burns keep the strongest single DPS (1), not the sum", l.burnDps, 1, 0.05);
    },
  };
}
