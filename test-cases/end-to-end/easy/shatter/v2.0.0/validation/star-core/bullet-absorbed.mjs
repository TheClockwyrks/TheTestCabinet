// Automated validation for the Star-core item `bullet-absorbed`: a bullet that reaches
// the core is absorbed and removed (not passed through, no score). A real bullet is
// placed just above the core heading into it; well within its lifetime the real
// collision code must remove it, and the score must not change.
//
// Placing the bullet on its way into the core is instant (`arrange`); the flight into the core
// and its absorption there are the behavior (`act`), so the clip is the bullet being swallowed.
// 0.5 s x 120 Hz = 60 ticks.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The state once the bullet has reached the core, read by `assert`.
  let snap;

  return {
    id: "star-core.bullet-absorbed",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      await api.call("addBullet", { x: 640, y: 300, vx: 0, vy: 120 });
    },

    async act(api) {
      // Advance less than a bullet's lifetime: if it is gone, it was absorbed, not expired.
      await api.advance(60);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the bullet is absorbed and removed at the core",
        snap.bullets.length,
        0,
      );
      check.expectEq("absorbing a bullet scores nothing", snap.score, 0);
    },
  };
}
