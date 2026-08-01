// Automated validation for the Progression item `timer-life`.
//
// Letting the crossing timer run out costs a life. The timer is set near zero and
// the real simulation runs it out into a death, which the snapshot reads back. See
// validation/_helpers.mjs.

import { actUntilDeath, startCrossing } from "../_helpers.mjs";

// The lives the crossing starts with, so the loss reads as a decrement.
const LIVES = 3;

// What is left on the crossing clock when `act` opens, in SECONDS (`setTimer` poses the
// clock rather than advancing it, so it is not a tick count).
//
// THE DRAIN IS THE CLIP. `act` is the recording, and the old 0.05 s expired about six
// ticks in — so the clip was a handful of frames of a run that was already over, and the
// HUD readout the item is about was never seen moving. Three seconds shows the countdown
// running down to zero and the life going with it. It changes nothing about the check:
// the timer still expires on the build's own clock and still has to cost a life, and it
// is still far shorter than the level's full timer, so only a real drain can reach zero.
const START_TIMER = 3;

// How long to wait for the death after that: the drain plus a second of slack, so a
// build whose expiry resolves a beat later is not called a failure.
const WAIT_TICKS = 480; // 4 s

export default function item() {
  // The sweep that waited for the timeout death.
  let r;

  return {
    id: "progression.timer-life",

    // Pose the timeout: three lives so the loss reads as a decrement, and the crossing
    // timer wound down to a few seconds so it drains to zero on camera.
    //
    // The bear is taken off the board. The window is now long enough for it to emerge,
    // and a hunter that reached the critter would spend the very life this item reads as
    // the timer's — so the timer is made the only thing that can end the crossing.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setBear", 0, null);
      await api.call("setTimer", START_TIMER);
    },

    // The timer draining out into a death — what is checked, and the clip.
    async act(api) {
      r = await actUntilDeath(api, LIVES, { max: WAIT_TICKS });
    },

    async assert(api, check) {
      check.expectOk("the timer running out costs a life", r.hit);
      check.expectEq(
        "a life is lost when the timer expires",
        r.snap.lives,
        LIVES - 1,
      );
    },
  };
}
