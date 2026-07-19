// Automated validation for towers.head-rotates: a firing component's head rotates to point at
// the target it is firing at.
//
// A tower is armed and a unit released; after a moment the head's heading must point at the
// unit (within a small tolerance).

import { armTower, spawnControlled, towerById, unitById, angleTo, angDiff, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.head-rotates");

  const towerId = await armTower(api, { type: "capacitor", tier: 1 });
  const [u] = await spawnControlled(api, "slug");
  await api.step(0.05); // let the head acquire and aim

  const s = await snap(api);
  const t = towerById(s, towerId);
  const live = unitById(s, u.id);
  const expected = angleTo(t.cx, t.cy, live);
  check.expectLt("the head points at the target it is firing at", angDiff(t.heading, expected), 0.2);

  await liveClip(api);
  return check.verdict();
}
