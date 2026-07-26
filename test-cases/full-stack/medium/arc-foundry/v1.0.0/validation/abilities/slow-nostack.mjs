// Automated validation for abilities.slow-nostack: repeated slows on one unit do not compound
// — the effective slow stays the strongest single value (refreshed on hit), never the product.
//
// A single Choke hits the same Slug several times over two seconds; the slow factor must stay
// at the single-hit 0.78, not fall toward 0.78^2 (~0.61).
//
// Arming the Choke and releasing the Slug are control ops (the arrange); the two seconds of
// repeated hits is the behavior under test, so it is the act and is what gets filmed.

import { armTower, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

export default function item() {
  // The unit `act` follows, and the Slug after the run of hits, read by `assert`.
  let unitId;
  let l;

  return {
    id: "abilities.slow-nostack",

    async arrange(api) {
      const towerId = await armTower(api, { type: "choke", tier: 1 });
      await api.call("setTargeting", towerId, "strongest"); // stay on the Slug even after Wave 1 begins
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
    },

    async act(api) {
      await api.advance(2 * SECOND); // 120 ticks — several Choke hits (cadence ~0.77 s)
      l = unitById(await snap(api), unitId);
      await api.screenshot("nostack");
    },

    async assert(api, check) {
      check.expectOk("the Slug is still alive to read", !!l);
      check.expectClose("repeated slows do not compound (stays at the single 0.78)", l.slowFactor, 0.78, 0.02);
      check.expectGt("...it is not driven below the single-hit value (no stacking)", l.slowFactor, 0.7);
    },
  };
}
