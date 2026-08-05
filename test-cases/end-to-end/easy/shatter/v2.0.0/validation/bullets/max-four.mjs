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
// the core to be absorbed, and the furthest one is still short of the right edge when the
// volley ends, so none of them wraps. The oldest bullet is 1.25 s old by then, inside its
// 1.5 s lifetime, and `newGame` has cleared the field, so nothing can be collided with.
//
// THE TAPS ARE SPACED WELL CLEAR OF THE FIRE INTERVAL, not merely past it. They used to
// sit at 24 ticks, which was the tightest spacing the old spec left room for: it read
// "at least 0.18 seconds apart ... roughly 5 to 6 shots per second", so an interval
// anywhere in 0.167-0.2 s was conformant and 24 ticks was exactly 0.2 s. A build at the
// slow end of that band rejected every second tap — the more so if it accumulated its
// clock in floating point, where 24 steps of 1/120 sum to 0.19999999999999998 and fall
// short of a `>= 0.2` gate — so it fired three shots, peaked at three, and this item
// called a correct cap too tight. `specs/ship.md` now fixes the gate at a whole 22 ticks,
// and 30 leaves eight ticks of room above it, so no rounding or accumulation order can
// put a tap on the wrong side.
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
        // 30 ticks (0.25 s), comfortably clear of the 22-tick fire interval, so each tap
        // is allowed to fire and the cap — not the rate limit — is what holds the count.
        await api.advance(30);
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
