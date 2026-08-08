// Automated validation for enemies.hp-scales-by-wave: as the waves deepen only HP scales
// (per the pinned formula); speed is unchanged wave to wave.
//
// WHAT IS FILMED, AND WHY THIS IS NO LONGER A STILL. The evidence used to be a frame of two Motes
// walking. Both are Motes, both are at full health, and the only thing that separates them is a
// maximum HP a reviewer cannot see — so the still showed two identical units and the claim, that
// one of them is many times tougher, was nowhere in it.
//
// A difference in toughness is only visible when something tries to kill them. So a Scrap
// Capacitor is armed on the corridor and both Motes walk into its reach: the Wave-1 Mote pops
// almost at once, and the Wave-10 Mote goes on soaking the same shots long after it. That is the
// claim, and it is now what the clip shows. The Wave-1 unit is released first so the tower's
// default `first` priority takes it before turning to the tougher one, which puts the two
// outcomes in order rather than interleaving them.
//
// The speed half of the claim is legible in the same clip: the pair walks in side by side at the
// same pace, which is what "only HP scales" means for movement.
//
// Both Motes are released through the real spawner, and every field the verdict compares is fixed
// at spawn — so the arrange poses the whole comparison and the act is purely what makes it
// visible.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  LOAD,
  scaledHp,
  SECOND,
} from "../_helpers.mjs";

// How far apart the pair is released, so they read as two units rather than one.
const GAP_TICKS = 0.6 * SECOND;
// Long enough for the Wave-1 Mote to be destroyed and for the Wave-10 one to visibly go on
// absorbing the same fire afterwards.
const CLIP_TICKS = 6 * SECOND;

export default function item() {
  // The two Motes as spawned (read by `assert`), and what became of them on camera.
  let w1;
  let w10;
  let end;

  return {
    id: "enemies.hp-scales-by-wave",

    async arrange(api) {
      // A Scrap Capacitor: weak enough that the Wave-10 Mote plainly survives it, strong enough
      // that the Wave-1 one does not.
      const towerId = await armTower(api, { type: "capacitor", tier: 1, difficulty: "medium" });
      [w1] = await spawnControlled(api, "mote", { wave: 1 });
      await api.skip(GAP_TICKS); // the fragile one leads, so it is taken first
      [w10] = await spawnControlled(api, "mote", { wave: 10 });
      await skipToApproach(api, towerId, w10.id);
    },

    async act(api) {
      await api.advance(CLIP_TICKS);
      end = await snap(api);
    },

    async assert(api, check) {
      check.expectEq("Wave-1 HP matches the formula", w1.maxHp, scaledHp(LOAD.mote.baseHp, 1, "medium"));
      check.expectEq("Wave-10 HP scales up by the formula", w10.maxHp, scaledHp(LOAD.mote.baseHp, 10, "medium"));
      check.expectGt("later-wave HP is higher", w10.maxHp, w1.maxHp);
      check.expectEq("speed is unchanged across waves", w10.baseSpeed, w1.baseSpeed);

      // The same claim, as the clip shows it: under identical fire the Wave-1 unit is gone and the
      // Wave-10 one is still standing. This is what makes the media evidence rather than
      // decoration, and it fails a build whose scaling reads correctly but does not bite.
      check.expectOk(
        "under the same tower's fire the Wave-1 Mote is destroyed first",
        !unitById(end, w1.id),
      );
      check.expectOk(
        "...while the tougher Wave-10 Mote is still standing",
        Boolean(unitById(end, w10.id)),
      );
    },
  };
}
