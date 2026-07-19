// Automated validation for abilities.burn: a Rectifier hit lights an overcurrent burn — a
// damage-over-time that keeps ticking HP loss after the shot lands, for a duration.

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.burn");

  const towerId = await armTower(api, { type: "rectifier", tier: 1 });
  await api.call("setTargeting", towerId, "strongest");
  const [u] = await spawnControlled(api, "slug");

  const r = await stepUntil(api, (s) => {
    const l = unitById(s, u.id);
    return l && l.burnDps > 0;
  }, 0.6);
  check.expectOk("the Rectifier lit a burn", r.hit);

  const s = await snap(api);
  const l = unitById(s, u.id);
  check.expectClose("burnDps is shotDamage x burnFrac (2 x 0.5 = 1)", l.burnDps, 1, 0.01);
  check.expectGt("the burn has a live duration", l.burnUntil, s.simTime);

  const hpAfterHit = l.hp;
  await api.step(0.6);
  check.expectLt("the burn keeps ticking HP loss after the shot", unitById(await snap(api), u.id).hp, hpAfterHit);

  await liveClip(api);
  return check.verdict();
}
