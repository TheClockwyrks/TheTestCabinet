// Automated validation for towers.auto-fire: a firing component fires automatically at a
// valid in-range unit with no manual trigger, and the unit takes HP loss.

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.auto-fire");

  await armTower(api, { type: "capacitor", tier: 1 });
  const [u] = await spawnControlled(api, "slug"); // high HP: survives to be read
  const hp0 = u.hp;

  const r = await stepUntil(api, (s) => {
    const l = unitById(s, u.id);
    return l && l.hp < hp0;
  }, 0.5);

  check.expectOk("the component fired on its own and damaged the in-range unit", r.hit);
  check.expectLt("the unit lost HP with no manual trigger", unitById(await snap(api), u.id).hp, hp0);

  await liveClip(api);
  return check.verdict();
}
