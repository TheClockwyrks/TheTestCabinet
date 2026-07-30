// Automated validation for the Progression item `timer-life`.
//
// Letting the crossing timer run out costs a life. The timer is set near zero and
// the real simulation runs it out into a death, which the snapshot reads back. See
// validation/_helpers.mjs.

import { actUntilDeath, startCrossing } from "../_helpers.mjs";

// The lives the crossing starts with, so the loss reads as a decrement.
const LIVES = 3;

export default function item() {
  // The sweep that waited for the timeout death.
  let r;

  return {
    id: "progression.timer-life",

    // Pose the timeout: three lives so the loss reads as a decrement, and the crossing
    // timer set a hair above zero so it expires almost immediately. `setTimer` takes
    // SECONDS — it poses the clock rather than advancing it, so it is not a tick count.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setTimer", 0.05);
    },

    // The timer draining out into a death — what is checked, and the clip. (The old
    // clip re-posed a 0.7 s timer for a longer drain; the assertions drove the 0.05 s
    // one, so that is what is filmed.)
    async act(api) {
      r = await actUntilDeath(api, LIVES, { max: 120 }); // 1 s
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
