// Automated validation for the Gameplay sub-item `countdown-frozen`.
//
// While the game is paused the pre-serve countdown must not advance: it freezes and
// resumes where it left off. A match is started with injected keys (opening on the
// countdown), advanced partway, then paused; a long stretch of time is then let pass.
// If the countdown kept running while paused it would elapse and the ball would serve
// — so the game must stay paused with the ball still held at center, and resume back
// into the countdown rather than a live rally. See validation/_helpers.mjs.

import { startWithKeys, ball0 } from "../_helpers.mjs";

export default function item() {
  let mid;
  let pausedScreen;
  let whilePaused;
  let resumedScreen;
  let resumed;

  return {
    id: "gameplay.countdown-frozen",

    // Navigate the title menu with injected keys, which leaves the match on its
    // pre-serve countdown. Everything after that is timed, so it belongs in `act`.
    async arrange(api) {
      await startWithKeys(api, "solo");
    },

    // The whole freeze/resume sequence, in order: partway into the countdown, pause,
    // let far more than the hold pass, resume, and let the remainder run out. That
    // sequence IS the clip — a reviewer watching it sees the countdown stop dead and
    // then pick up exactly where it left off. Every reading is captured here and
    // asserted afterwards, so neither pass ever branches on a verdict.
    async act(api) {
      // Advance partway into the countdown.
      await api.advance(24); // 24 ticks = the old 0.2s
      mid = await api.snapshot();

      // Pause, then let far more than the ~1 s hold pass. The old script deliberately
      // burned this stretch on BOTH clocks (an instant `step(5)` plus a real
      // `wait(300)`), because a countdown that only advanced on one of them would have
      // slipped past a test that used the other. Under the two-pass runtime a single
      // `advance` already covers both — it is simulation time while the verdict is
      // being decided and wall-clock time while the clip records — so the two calls
      // collapse into one stretch of the same total length.
      await api.call("press", "Escape");
      pausedScreen = (await api.snapshot()).screen;
      // 636 ticks = 600 (the old step(5)) + 36 (the old wait(300)).
      await api.advance(636);

      whilePaused = await api.snapshot();

      // Resuming returns to the countdown (it did not skip ahead to a live serve).
      await api.call("press", "Escape");
      resumedScreen = (await api.snapshot()).screen;

      // The resumed countdown is live, not stuck for good: let the remaining hold run
      // out and confirm the ball actually serves. A frozen countdown that resumes but
      // never launches — the ball left sitting at center — is caught here, where the
      // screen check above (which only sees that the countdown came back) would miss
      // it.
      await api.advance(144); // 144 ticks = the old 1.2s, past the remainder of the ~1 s hold
      resumed = await api.snapshot();

      // A tail on the now-live rally, so the clip ends on the ball actually moving
      // rather than on the frame it launched.
      await api.advance(48); // 48 ticks = the old 400ms clip tail
    },

    async assert(api, check) {
      check.expectEq("still counting down partway in", mid.screen, "countdown");

      check.expectEq("the game is paused", pausedScreen, "paused");

      check.expectEq(
        "stepping while paused leaves the game paused — the countdown did not run",
        whilePaused.screen,
        "paused",
      );
      check.expectClose(
        "the held ball did not move while paused (x)",
        ball0(whilePaused).x,
        ball0(mid).x,
        1,
      );
      check.expectClose(
        "the held ball did not move while paused (y)",
        ball0(whilePaused).y,
        ball0(mid).y,
        1,
      );

      check.expectEq(
        "resuming returns to the countdown, not a live rally",
        resumedScreen,
        "countdown",
      );

      check.expectEq(
        "the resumed countdown runs out and the ball serves",
        resumed.screen,
        "playing",
      );
      check.expectOk(
        "the served ball is moving once the resumed countdown elapses",
        Math.hypot(ball0(resumed).vx, ball0(resumed).vy) > 1,
      );
    },
  };
}
