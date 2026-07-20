// Automated validation for abilities.slow-nostack: repeated slows on one unit do not compound
// — the effective slow stays the strongest single value (refreshed on hit), never the product.
//
// A single Choke hits the same Slug several times over two seconds; the slow factor must stay
// at the single-hit 0.78, not fall toward 0.78^2 (~0.61).

import { armTower, spawnControlled, unitById, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.slow-nostack");

  const towerId = await armTower(api, { type: "choke", tier: 1 });
  await api.call("setTargeting", towerId, "strongest"); // stay on the Slug even after Wave 1 begins
  const [u] = await spawnControlled(api, "slug");

  await api.step(2.0); // several Choke hits (cadence ~0.77 s)
  const l = unitById(await snap(api), u.id);
  check.expectOk("the Slug is still alive to read", !!l);
  check.expectClose("repeated slows do not compound (stays at the single 0.78)", l.slowFactor, 0.78, 0.02);
  check.expectGt("...it is not driven below the single-hit value (no stacking)", l.slowFactor, 0.7);

  await api.screenshot("nostack");
  return check.verdict();
}
