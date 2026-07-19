// Automated validation for enemies.roster-stats: each Load type spawns with its pinned base
// stats. The observable fields are base speed, flying, and Wave-1 HP (which reflects the base
// HP scaled by the difficulty). Bounty and leak are exercised by economy.kill-bounty and
// economy.leak-integrity.

import { startBuild, spawnControlled, LOAD, scaledHp, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("enemies.roster-stats");

  await startBuild(api, { difficulty: "medium" });
  for (const type of ["mote", "spark", "slug", "cluster", "filament", "dynamo"]) {
    const [u] = await spawnControlled(api, type, { wave: 1 });
    const def = LOAD[type];
    check.expectEq(`${type} base speed`, u.baseSpeed, def.speed);
    check.expectEq(`${type} flying`, u.flying, def.flies);
    check.expectEq(`${type} Wave-1 HP (base x difficulty)`, u.maxHp, scaledHp(def.baseHp, 1, "medium"));
  }

  await api.screenshot("roster");
  return check.verdict();
}
