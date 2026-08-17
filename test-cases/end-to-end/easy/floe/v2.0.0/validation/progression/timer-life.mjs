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

// The least of the drain that must have actually run before the life goes.
//
// A LIFE LOST IS NOT THE SAME FACT AS A TIMER EXPIRING. The sweep watches the life
// count, which is the only thing specs/gameplay.md makes a death mean — but on this
// posed board it is not the only thing that CAN spend one. A build that puts a hunter
// on top of the critter the moment a crossing begins (one audited against this case
// does exactly that) loses its life within a tick or two, and the item then reports
// that the timer costs a life while the clock still reads nearly three seconds. The
// posed clock is what tells the two apart: a death that is the timer's cannot land
// before the timer has run, so the sweep must have spent most of the drain.
const MIN_DRAIN_TICKS = 240; // 2 s of the posed 3 s

// How long the clip keeps filming after the life goes. `act` IS the recording and the
// sweep returns on the tick of the decrement, so without this the clip ended on the
// frame the clock hit zero — the countdown was on camera and the thing it costs was
// not.
const TAIL_TICKS = 180; // 1.5 s

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
      await api.advance(TAIL_TICKS); // camera only: the life coming off, and the respawn
    },

    async assert(api, check) {
      check.expectOk("the timer running out costs a life", r.hit);
      // A sweep that found no death spent its whole budget, which would sail over the
      // floor below; read a missing death as no drain at all so this fails beside the
      // assertion above rather than holding vacuously.
      check.expectGe(
        "the life goes when the clock runs out, not before it",
        r.hit ? r.spent : 0,
        MIN_DRAIN_TICKS,
      );
      check.expectEq(
        "a life is lost when the timer expires",
        r.snap.lives,
        LIVES - 1,
      );
    },
  };
}
