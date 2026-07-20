// Automated validation for towers.projectile-carries-hit: every shot is a visible traveling
// projectile that carries the hit on impact — the shot is in flight before the target loses
// HP, so damage lands on arrival, not at the instant of firing (not hitscan).

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.projectile-carries-hit");

  await armTower(api, { type: "discharge", tier: 1 }); // a heavy, single traveling bolt
  const [u] = await spawnControlled(api, "slug");
  const hp0 = u.hp;

  // A projectile is launched and travels before it reaches the target.
  const r1 = await stepUntil(api, (s) => s.projectiles.length > 0, 0.3);
  check.expectOk("a projectile is launched and travels", r1.hit);
  const inFlight = await snap(api);
  check.expectEq("the target has not lost HP while the shot is still in flight", unitById(inFlight, u.id).hp, hp0);

  // The hit lands only when the projectile reaches the target.
  const r2 = await stepUntil(api, (s) => {
    const l = unitById(s, u.id);
    return l && l.hp < hp0;
  }, 0.6);
  check.expectOk("the hit lands only on impact (not hitscan)", r2.hit);

  await liveClip(api);
  return check.verdict();
}
