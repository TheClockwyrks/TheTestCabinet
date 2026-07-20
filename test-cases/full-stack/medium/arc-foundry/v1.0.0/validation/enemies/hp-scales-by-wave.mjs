// Automated validation for enemies.hp-scales-by-wave: as the waves deepen only HP scales
// (per the pinned formula); speed is unchanged wave to wave.

import { startBuild, spawnControlled, LOAD, scaledHp, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("enemies.hp-scales-by-wave");

  await startBuild(api, { difficulty: "medium" });
  const [w1] = await spawnControlled(api, "mote", { wave: 1 });
  const [w10] = await spawnControlled(api, "mote", { wave: 10 });

  check.expectEq("Wave-1 HP matches the formula", w1.maxHp, scaledHp(LOAD.mote.baseHp, 1, "medium"));
  check.expectEq("Wave-10 HP scales up by the formula", w10.maxHp, scaledHp(LOAD.mote.baseHp, 10, "medium"));
  check.expectGt("later-wave HP is higher", w10.maxHp, w1.maxHp);
  check.expectEq("speed is unchanged across waves", w10.baseSpeed, w1.baseSpeed);

  await api.screenshot("scale");
  return check.verdict();
}
