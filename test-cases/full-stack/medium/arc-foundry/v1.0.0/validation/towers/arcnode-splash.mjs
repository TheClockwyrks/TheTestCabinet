// Automated validation for towers.arcnode-splash: the Arc-Node's shot detonates a discharge
// that damages every unit within its splash radius of the impact point.

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.arcnode-splash");

  await armTower(api, { type: "arcnode", tier: 1 });
  const units = await spawnControlled(api, "mote", { count: 3 }); // a cluster at the Entry
  const ids = units.map((u) => u.id);
  const s0 = await snap(api);
  const initHp = {};
  for (const id of ids) {
    const l = unitById(s0, id);
    if (l) initHp[id] = l.hp;
  }

  const r = await stepUntil(api, (s) => {
    let hurt = 0;
    for (const id of ids) {
      const l = unitById(s, id);
      if (l && l.hp < initHp[id]) hurt += 1;
    }
    return hurt >= 2;
  }, 0.5);

  check.expectOk("the Arc-Node's discharge damaged multiple units in the cluster (splash)", r.hit);

  await liveClip(api);
  return check.verdict();
}
