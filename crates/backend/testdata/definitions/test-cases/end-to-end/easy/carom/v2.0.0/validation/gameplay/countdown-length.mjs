// Automated validation for the Gameplay sub-item `countdown-length`: the pre-serve
// countdown lasts a fixed 1.0 s before the ball serves (balls-standard.md), which at
// the 120 Hz timestep is 120 ticks.
//
// A match is started (opening on the held countdown) and the real simulation is
// stepped one tick at a time until the ball serves; the number of ticks the hold
// lasted is what is checked. Nothing is posed but the match start; the countdown runs
// on the real clock.

import {
  arrangeCountdown,
  actCountdownTicks,
  HOLD_TICKS,
  ball0,
} from "../_helpers.mjs";

export default function item() {
  let start;
  let ticks;
  let served;
  let snap;

  return {
    id: "gameplay.countdown-length",

    // Start a match, which opens on the pre-serve hold with the ball held at center.
    async arrange(api) {
      await arrangeCountdown(api, "versus");
    },

    // Step until the ball serves, counting the hold. This IS the clip: the reviewer
    // watches the countdown run out and the ball launch.
    async act(api) {
      ({ start, ticks, served, snap } = await actCountdownTicks(api));
      // A short tail so the clip ends on the served ball moving, not the launch frame.
      await api.advance(48);
    },

    async assert(api, check) {
      check.expectEq(
        "the match opens on the countdown",
        start.screen,
        "countdown",
      );
      check.expectEq(
        "the ball is held during the countdown",
        ball0(start).held,
        true,
      );
      check.expectOk("the countdown runs out and the ball serves", served);
      check.expectClose(
        "the pre-serve countdown lasts the 1.0 s hold (ticks at 120 Hz)",
        ticks,
        HOLD_TICKS,
        3,
      );
      check.expectOk(
        "the ball is moving once the countdown elapses",
        Math.hypot(ball0(snap).vx, ball0(snap).vy) > 1,
      );
    },
  };
}
