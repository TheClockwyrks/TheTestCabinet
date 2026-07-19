// Automated validation for towers.regulator-nonfiring: the Regulator is a non-firing support
// node — it never fires, launches no projectile, does not rotate a head or damage a unit in
// range, and only projects an aura.

import { armTower, spawnControlled, towerById, unitById, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.regulator-nonfiring");

  const towerId = await armTower(api, { type: "regulator", tier: 1 });
  const [u] = await spawnControlled(api, "mote");
  const hp0 = u.hp;

  await api.step(0.5); // well past when a firing tower would have shot

  const s = await snap(api);
  const t = towerById(s, towerId);
  const live = unitById(s, u.id);

  check.expectEq("the Regulator has no targeting control", t.targeting, null);
  check.expectEq("...deals no damage", t.damage, 0);
  check.expectEq("...projects an aura instead", t.abilities.includes("aura"), true);
  check.expectGt("...with a real aura radius", t.auraRadius, 0);
  check.expectOk("the head does not rotate", t.heading === 0);
  check.expectOk("no projectile is fired", s.projectiles.length === 0);
  check.expectEq("the unit in range is unharmed by the Regulator", live ? live.hp : hp0, hp0);
  check.expectEq("the Regulator still occupies the board (it walls)", t.kind, "component");

  await api.screenshot("regulator");
  return check.verdict();
}
