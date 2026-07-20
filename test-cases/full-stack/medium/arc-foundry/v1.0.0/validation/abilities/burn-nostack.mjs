// Automated validation for abilities.burn-nostack: repeated burns on one unit do not add up —
// the burn damage-per-second stays the strongest single value (refreshed on hit), not the sum.
//
// A single Rectifier hits the same Slug several times over two seconds; burnDps must stay ~1,
// not climb toward 2.

import { armTower, spawnControlled, unitById, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.burn-nostack");

  const towerId = await armTower(api, { type: "rectifier", tier: 1 });
  await api.call("setTargeting", towerId, "strongest");
  const [u] = await spawnControlled(api, "slug");

  await api.step(2.0); // several Rectifier hits
  const l = unitById(await snap(api), u.id);
  check.expectOk("the Slug is still alive to read", !!l);
  check.expectClose("repeated burns keep the strongest single DPS (1), not the sum", l.burnDps, 1, 0.05);

  await api.screenshot("nostack");
  return check.verdict();
}
