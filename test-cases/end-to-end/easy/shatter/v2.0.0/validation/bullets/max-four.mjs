// Automated validation for the Bullets item `max-four`: at most four of the ship's
// bullets exist at once. The ship is posed on a clear lane, and Space is tapped five
// times (with enough spacing to clear the fire-rate limit each time); the on-screen
// bullet count is tracked and must peak at four, never five.
//
// THE VOLLEY IS FLOWN WHERE NOTHING CAN TAKE A BULLET OFF THE FIELD, which is the whole
// reason for the pose. A count that peaks below four says either "the cap is too tight"
// or "something removed a bullet", and this item can only mean the first if the second
// is impossible. So the lane is chosen to rule the second out: the ship sits low on the
// left firing due right, 260 px below the star's row, so no bullet passes near enough to
// the core to be absorbed, and the furthest one has only reached the middle of the field
// when the volley ends, so none of them wraps. Every bullet is also well inside its 1.5 s
// lifetime, and `newGame` has cleared the field, so nothing can be collided with.
//
// It used to fire up-left from (200, 200), which sent the volley diagonally into the
// top-left corner about half a second in — inside the volley, so the count this item
// reads depended on the build wrapping a bullet across two seams at once and keeping it.
// A build that dropped bullets on that corner reported a peak of two, and the item
// called it a cap fault. Wrapping is `wrap/bullet`'s subject, including the diagonal
// case, and it is graded there.
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
      await poseShip(api, { x: 120, y: 620, vx: 0, vy: 0, angle: 0 });
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
