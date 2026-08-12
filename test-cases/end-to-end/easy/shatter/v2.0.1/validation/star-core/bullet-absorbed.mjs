// Automated validation for the Star-core item `bullet-absorbed`: a bullet that reaches
// the core is absorbed and removed (not passed through, no score). A real bullet is
// placed just above the core heading into it; well within its lifetime the real
// collision code must remove it, and the score must not change.
//
// Placing the bullet on its way into the core is instant (`arrange`); the flight into the core
// and its absorption there are the behavior (`act`), so the clip is the bullet being swallowed.
//
// It is placed a clear run above the core rather than on its doorstep, and the drive carries
// on past the absorption, so the recording — which films `act` — shows the approach and the
// empty field it leaves rather than a single frame at the core. 1.1 s x 120 Hz = 132 ticks;
// what matters for the check is only that this stays well inside a bullet's 1.5 s lifetime,
// so a bullet that is gone was absorbed rather than expired.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The state once the bullet has reached the core, read by `assert`.
  let snap;

  return {
    id: "star-core.bullet-absorbed",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      await api.call("addBullet", { x: 640, y: 120, vx: 0, vy: 240 });
    },

    async act(api) {
      // Advance less than a bullet's lifetime: if it is gone, it was absorbed, not expired.
      await api.advance(132);
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
