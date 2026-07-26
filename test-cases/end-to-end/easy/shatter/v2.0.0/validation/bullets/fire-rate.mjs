// Automated validation for the Bullets item `fire-rate`: fire is rate-limited (~0.18 s
// between shots). The ship taps fire, then taps again too soon (which must NOT fire),
// then taps once more after the interval has elapsed (which must fire).
//
// Only the ship's pose is a precondition, so `arrange` is just that; the taps themselves and
// the waits BETWEEN them are the behavior under test, so they are `act` — and the clip shows
// the rejected tap and the accepted one in the order the check makes them.
//
// The waits are written as tick counts: 0.05 s x 120 Hz = 6 ticks (well under the interval)
// and 0.15 s x 120 Hz = 18 ticks, which carries the total past the ~0.18 s (21.6-tick) fire
// interval. FIRE_INTERVAL itself is deliberately not used to drive time — it is 21.6 ticks,
// not a whole tick count, and the contract rejects a fractional step.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The on-screen bullet count after each of the three taps, read by `assert`.
  let afterFirst;
  let afterTooSoon;
  let afterInterval;

  return {
    id: "bullets.fire-rate",

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
      await api.call("press", "Space"); // first shot
      afterFirst = (await api.snapshot()).bullets.length;

      await api.advance(6); // 0.05 s — well under the fire interval
      await api.call("press", "Space"); // too soon — must not fire
      afterTooSoon = (await api.snapshot()).bullets.length;

      await api.advance(18); // 0.15 s more — now past ~0.18 s since the first shot
      await api.call("press", "Space"); // allowed again
      afterInterval = (await api.snapshot()).bullets.length;
    },

    async assert(api, check) {
      check.expectEq("the first tap fires a bullet", afterFirst, 1);
      check.expectEq(
        "a second tap within the interval does not fire",
        afterTooSoon,
        1,
      );
      check.expectEq("a tap after the interval fires again", afterInterval, 2);
    },
  };
}
