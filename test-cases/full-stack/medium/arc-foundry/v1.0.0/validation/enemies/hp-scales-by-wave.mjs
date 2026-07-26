// Automated validation for enemies.hp-scales-by-wave: as the waves deepen only HP scales
// (per the pinned formula); speed is unchanged wave to wave.
//
// Both Motes are released through the real spawner, which is instant, and every field compared
// is fixed at spawn — so the arrange poses the whole comparison and the act simply lets the two
// units walk, which is what makes "same speed, different HP" legible on screen.

import { startBuild, spawnControlled, LOAD, scaledHp, SECOND } from "../_helpers.mjs";

// Long enough for both Motes to cover ground side by side — that is the speed claim, visibly.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The two Motes as spawned, read by `assert`.
  let w1;
  let w10;

  return {
    id: "enemies.hp-scales-by-wave",

    async arrange(api) {
      await startBuild(api, { difficulty: "medium" });
      [w1] = await spawnControlled(api, "mote", { wave: 1 });
      [w10] = await spawnControlled(api, "mote", { wave: 10 });
    },

    async act(api) {
      await api.advance(CLIP_TICKS);
      await api.screenshot("scale");
    },

    async assert(api, check) {
      check.expectEq("Wave-1 HP matches the formula", w1.maxHp, scaledHp(LOAD.mote.baseHp, 1, "medium"));
      check.expectEq("Wave-10 HP scales up by the formula", w10.maxHp, scaledHp(LOAD.mote.baseHp, 10, "medium"));
      check.expectGt("later-wave HP is higher", w10.maxHp, w1.maxHp);
      check.expectEq("speed is unchanged across waves", w10.baseSpeed, w1.baseSpeed);
    },
  };
}
