// Automated validation for towers.hits-air: a firing component in range hits the airborne
// Filament flyer as readily as a ground unit.

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.hits-air");

  await armTower(api, { type: "capacitor", tier: 1 });
  const [f] = await spawnControlled(api, "filament");
  check.expectOk("the target is airborne", f.flying === true);
  const hp0 = f.hp;

  const r = await stepUntil(api, (s) => {
    const l = unitById(s, f.id);
    return l && l.hp < hp0;
  }, 0.5);

  check.expectOk("the component hit the airborne Filament", r.hit);

  await liveClip(api);
  return check.verdict();
}
