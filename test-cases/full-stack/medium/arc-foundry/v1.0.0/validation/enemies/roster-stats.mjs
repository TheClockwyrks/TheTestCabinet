// Automated validation for enemies.roster-stats: each Load type spawns with its pinned base
// stats. The observable fields are base speed, flying, and Wave-1 HP (which reflects the base
// HP scaled by the difficulty). Bounty and leak are exercised by economy.kill-bounty and
// economy.leak-integrity.
//
// Every field compared is fixed at spawn and the spawner is instant, so the whole roster is
// released in the arrange. The act then lets them walk, which is what puts the roster — six
// distinct silhouettes moving at six distinct speeds — on screen for the capture.

import { startBuild, spawnControlled, LOAD, scaledHp, SECOND } from "../_helpers.mjs";

// Long enough for the roster to string out along the first leg by speed.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // Each released unit by type, read by `assert`.
  const released = {};

  return {
    id: "enemies.roster-stats",

    async arrange(api) {
      await startBuild(api, { difficulty: "medium" });
      for (const type of ["mote", "spark", "slug", "cluster", "filament", "dynamo"]) {
        const [u] = await spawnControlled(api, type, { wave: 1 });
        released[type] = u;
      }
    },

    async act(api) {
      await api.advance(CLIP_TICKS);
      await api.screenshot("roster");
    },

    async assert(api, check) {
      for (const type of ["mote", "spark", "slug", "cluster", "filament", "dynamo"]) {
        const u = released[type];
        const def = LOAD[type];
        check.expectEq(`${type} base speed`, u.baseSpeed, def.speed);
        check.expectEq(`${type} flying`, u.flying, def.flies);
        check.expectEq(`${type} Wave-1 HP (base x difficulty)`, u.maxHp, scaledHp(def.baseHp, 1, "medium"));
      }
    },
  };
}
