// Automated validation for abilities.slow: a Choke hit scales the struck unit's speed by
// (1 - amt) for a duration; only its speed changes.

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.slow");

  const towerId = await armTower(api, { type: "choke", tier: 1 });
  await api.call("setTargeting", towerId, "strongest"); // keep the Choke on the Slug
  const [u] = await spawnControlled(api, "slug");

  const r = await stepUntil(api, (s) => {
    const l = unitById(s, u.id);
    return l && l.slowFactor < 1;
  }, 0.6);
  check.expectOk("the Choke slowed the struck unit", r.hit);

  const s = await snap(api);
  const l = unitById(s, u.id);
  check.expectClose("the slow factor is 1 - slowAmt (T1 Choke = 0.78)", l.slowFactor, 0.78, 0.01);
  check.expectClose("the effective speed is base x slowFactor", l.speed, l.baseSpeed * l.slowFactor, 0.6);
  check.expectGt("the slow has a live duration", l.slowUntil, s.simTime);

  await liveClip(api);
  return check.verdict();
}
