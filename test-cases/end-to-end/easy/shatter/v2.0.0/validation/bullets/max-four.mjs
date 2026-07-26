// Automated validation for the Bullets item `max-four`: at most four of the ship's
// bullets exist at once. The ship is posed firing away from the star, and Space is
// tapped five times (with enough spacing to clear the fire-rate limit each time); the
// on-screen bullet count is tracked and must peak at four, never five.
//
// The ship's pose is the only precondition (`arrange`); the five taps and the gaps between
// them are the behavior (`act`), so the clip shows the volley building up and stalling at
// four rather than growing to five.

import { newGame, poseShip, MAX_BULLETS } from "../_helpers.mjs";

export default function item() {
  // The high-water mark across the volley and the count it ended on, read by `assert`.
  let maxSeen;
  let final;

  return {
    id: "bullets.max-four",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, {
        x: 200,
        y: 200,
        vx: 0,
        vy: 0,
        angle: (-135 * Math.PI) / 180,
      });
    },

    async act(api) {
      maxSeen = 0;
      for (let i = 0; i < 5; i += 1) {
        await api.call("press", "Space");
        // 0.2 s x 120 Hz = 24 ticks, which clears the ~0.18 s fire interval so each tap
        // is allowed to fire and the cap — not the rate limit — is what holds the count.
        await api.advance(24);
        maxSeen = Math.max(maxSeen, (await api.snapshot()).bullets.length);
      }
      final = (await api.snapshot()).bullets.length;
    },

    async assert(api, check) {
      check.expectEq(
        "five shots never put more than four bullets on screen",
        maxSeen,
        MAX_BULLETS,
      );
      check.expectLe(
        "the on-screen bullet count is capped at four",
        final,
        MAX_BULLETS,
      );
    },
  };
}
