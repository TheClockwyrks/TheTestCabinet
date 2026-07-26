// Automated validation for the Saucer item `fires-at-ship`: the saucer fires bullets
// aimed at the ship. A saucer is posed on the left, well clear of the star, with the ship
// far to its right; as the real sim runs past the saucer's fire interval it must emit an
// enemy bullet travelling toward the ship (rightward).
//
// Posing the ship and spawning the saucer are instant (`arrange`); waiting out the saucer's fire
// interval is the behavior (`act`), so the clip is the shot being taken.
//
// The sweep stays a LOOP because the saucer is re-pinned to its spot on every iteration (so it
// holds position instead of drifting) and the enemy bullet has to be caught the moment it
// appears. The old drive ran 120 x 0.02 s = 2.4 s; 0.02 s is 2.4 ticks, not a whole tick count,
// so this samples every 2 ticks — finer than the old cadence — and runs 144 of them, keeping the
// total at 288 ticks, exactly the old 2.4 s budget.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The first enemy bullet the saucer fired, read by `assert`.
  let shot;

  return {
    id: "saucer.fires-at-ship",

    // Pose the ship to the saucer's right, within half a field so the shortest
    // wrapped path from the saucer to the ship runs rightward (no wrap seam between
    // them).
    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 700, y: 360, vx: 0, vy: 0, angle: 0 });
      await api.call("spawnSaucer");
    },

    async act(api) {
      shot = null;
      for (let i = 0; i < 144; i += 1) {
        // Re-pin the saucer each sample so it holds its spot instead of drifting.
        await api.call("setSaucer", { x: 220, y: 360, vx: 0, vy: 0 });
        await api.advance(2);
        const eb = (await api.snapshot()).enemyBullets;
        if (eb.length > 0) {
          shot = eb[0];
          break;
        }
      }
    },

    async assert(api, check) {
      check.expectOk("the saucer fires an enemy bullet", Boolean(shot));
      if (shot) {
        check.expectGt(
          "the shot is aimed at the ship (travelling toward it, to the right)",
          shot.vx,
          80,
        );
      }
    },
  };
}
