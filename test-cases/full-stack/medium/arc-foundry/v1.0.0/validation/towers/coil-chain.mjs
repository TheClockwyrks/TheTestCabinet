// Automated validation for towers.coil-chain: the Coil's bolt leaps from the struck unit to
// nearby extra units, so one shot damages several units in a pack.

import { armTower, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("towers.coil-chain");

  await armTower(api, { type: "coil", tier: 1 });
  const units = await spawnControlled(api, "mote", { count: 3 }); // a tight pack at the Entry
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

  check.expectOk("the Coil's bolt chained, damaging at least two units in the pack", r.hit);

  await liveClip(api);
  return check.verdict();
}
